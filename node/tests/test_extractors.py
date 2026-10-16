import json
import types
from pathlib import Path
from typing import Any, Self

import pytest
from yt_digest_node.extractors import (
    Extraction,
    FakeExtractor,
    Track,
    YtDlpExtractor,
    choose_track,
    make_extractor,
    parse_delay,
)

LANGS = ["fr", "en"]


def _video(root: Path, files: dict[str, str]) -> None:
    (root / "abc").mkdir()
    for name, text in files.items():
        (root / "abc" / name).write_text(text, encoding="utf-8")


def test_missing_directory_is_unavailable(tmp_path: Path) -> None:
    assert FakeExtractor(tmp_path).extract("abc", LANGS) == "unavailable"


@pytest.mark.parametrize("status", ["blocked", "unavailable"])
def test_meta_status_is_returned(tmp_path: Path, status: str) -> None:
    _video(tmp_path, {"meta.json": json.dumps({"duration": 5, "status": status})})
    assert FakeExtractor(tmp_path).extract("abc", LANGS) == status


def test_fake_tracks(tmp_path: Path) -> None:
    _video(
        tmp_path,
        {"meta.json": '{"duration": 12}', "fr.auto.vtt": "A", "en.manual.vtt": "B"},
    )
    result = FakeExtractor(tmp_path).extract("abc", LANGS)
    assert result == Extraction(
        12, [Track("en", "manual", "B"), Track("fr", "auto", "A")]
    )


def test_choice_prefers_manual_in_language_order() -> None:
    tracks = [Track("fr", "auto", "A"), Track("en", "manual", "B")]
    assert choose_track(tracks, ["fr", "en"]) == tracks[1]


def test_choice_falls_back_to_auto_in_language_order() -> None:
    tracks = [Track("en", "auto", "A"), Track("fr", "auto", "B")]
    assert choose_track(tracks, ["fr", "en"]) == tracks[1]


def test_choice_none() -> None:
    assert choose_track([Track("de", "manual", "X")], ["fr", "en"]) is None


def test_fixture_files_to_choice(tmp_path: Path) -> None:
    _video(
        tmp_path,
        {"meta.json": '{"duration": 1}', "fr.auto.vtt": "A", "en.manual.vtt": "B"},
    )
    result = FakeExtractor(tmp_path).extract("abc", LANGS)
    assert isinstance(result, Extraction)
    assert choose_track(result.tracks, ["fr", "en"]) == Track("en", "manual", "B")


def test_fixture_only_german_manual_is_no_transcript(tmp_path: Path) -> None:
    _video(tmp_path, {"meta.json": '{"duration": 1}', "de.manual.vtt": "X"})
    result = FakeExtractor(tmp_path).extract("abc", LANGS)
    assert isinstance(result, Extraction)
    assert choose_track(result.tracks, ["fr", "en"]) is None


def test_make_extractor_fake(tmp_path: Path) -> None:
    env = {"FETCHER_FAKE_YTDLP": "1", "FAKE_YTDLP_DIR": str(tmp_path)}
    assert isinstance(make_extractor(env), FakeExtractor)
    with pytest.raises(ValueError):
        make_extractor({"FETCHER_FAKE_YTDLP": "1"})


def test_make_extractor_default_delay() -> None:
    assert isinstance(make_extractor({}), YtDlpExtractor)
    assert parse_delay("2-5") == (2.0, 5.0)
    assert parse_delay("0") == (0.0, 0.0)


class _DownloadError(Exception):
    pass


def _stub(
    info: dict[str, Any] | Exception,
    seen: dict[str, Any],
    body: bytes = b"WEBVTT",
) -> types.ModuleType:
    seen["opened"] = []

    class Response:
        def read(self) -> bytes:
            return body

    class YoutubeDL:
        def __init__(self, options: dict[str, Any]) -> None:
            seen["options"] = options

        def __enter__(self) -> Self:
            return self

        def __exit__(self, *args: object) -> None:
            return None

        def extract_info(self, url: str, download: bool) -> dict[str, Any]:
            seen["url"] = url
            seen["download"] = download
            if isinstance(info, Exception):
                raise info
            return info

        def urlopen(self, url: str) -> Response:
            seen["opened"].append(url)
            return Response()

    module = types.ModuleType("yt_dlp")
    module.YoutubeDL = YoutubeDL  # type: ignore[attr-defined]
    module.utils = types.SimpleNamespace(DownloadError=_DownloadError)  # type: ignore[attr-defined]
    return module


def test_ytdlp_options_and_only_chosen_track_is_fetched() -> None:
    seen: dict[str, Any] = {}
    info = {
        "duration": 30,
        "subtitles": {
            "en": [{"ext": "json3", "url": "u0"}, {"ext": "vtt", "url": "u1"}],
            "de": [{"ext": "vtt", "url": "u3"}],
        },
        "automatic_captions": {"fr": [{"ext": "vtt", "url": "u2"}]},
    }
    delays: list[float] = []
    extractor = YtDlpExtractor((0.0, 0.0), _stub(info, seen), delays.append)
    assert extractor.extract("abc", LANGS) == Extraction(
        30, [Track("en", "manual", "WEBVTT")]
    )
    options = seen["options"]
    assert options["skip_download"] is True
    assert options["writesubtitles"] is True
    assert options["writeautomaticsub"] is True
    assert options["subtitlesformat"] == "vtt"
    assert not {"cookiefile", "cookiesfrombrowser"} & options.keys()
    assert seen["download"] is False
    assert seen["url"].endswith("abc")
    assert seen["opened"] == ["u1"]
    assert len(delays) == 2


def test_ytdlp_prefers_original_auto_caption_over_translation() -> None:
    seen: dict[str, Any] = {}
    info = {
        "duration": 3,
        "automatic_captions": {
            "fr": [{"ext": "vtt", "url": "tr"}],
            "en-orig": [{"ext": "vtt", "url": "orig"}],
            "en": [{"ext": "vtt", "url": "en"}],
        },
    }
    extractor = YtDlpExtractor((0, 0), _stub(info, seen), lambda s: None)
    assert extractor.extract("abc", LANGS) == Extraction(
        3, [Track("en", "auto", "WEBVTT")]
    )
    assert seen["opened"] == ["orig"]


def test_ytdlp_no_matching_track_fetches_nothing() -> None:
    seen: dict[str, Any] = {}
    info = {"duration": 3, "subtitles": {"de": [{"ext": "vtt", "url": "u"}]}}
    extractor = YtDlpExtractor((0, 0), _stub(info, seen), lambda s: None)
    assert extractor.extract("abc", LANGS) == Extraction(3, [])
    assert seen["opened"] == []


def test_ytdlp_non_utf8_body_does_not_raise() -> None:
    info = {"duration": 3, "subtitles": {"en": [{"ext": "vtt", "url": "u"}]}}
    stub = _stub(info, {}, body=b"WEBVTT \xff")
    result = YtDlpExtractor((0, 0), stub, lambda s: None).extract("abc", LANGS)
    assert isinstance(result, Extraction)
    assert result.tracks[0].vtt == "WEBVTT \ufffd"


def test_ytdlp_private_video_is_unavailable() -> None:
    error = _DownloadError("ERROR: [youtube] abc: Private video. Sign in")
    assert (
        YtDlpExtractor((0, 0), _stub(error, {}), lambda s: None).extract("abc", LANGS)
        == "unavailable"
    )


def test_ytdlp_bot_check_is_blocked() -> None:
    error = _DownloadError("ERROR: Sign in to confirm you’re not a bot")
    assert (
        YtDlpExtractor((0, 0), _stub(error, {}), lambda s: None).extract("abc", LANGS)
        == "blocked"
    )


def test_delay_range_reaches_sleep() -> None:
    info = {"duration": 3, "subtitles": {"en": [{"ext": "vtt", "url": "u"}]}}
    delays: list[float] = []
    YtDlpExtractor(parse_delay("1-1"), _stub(info, {}), delays.append).extract(
        "abc", LANGS
    )
    assert delays == [1.0, 1.0]
    extractor = make_extractor({"YT_DELAY_SECONDS": "7"})
    assert isinstance(extractor, YtDlpExtractor)
    assert extractor._delay == (7.0, 7.0)
