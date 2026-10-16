import importlib
import json
import os
import random
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path
from types import ModuleType
from typing import Literal

Failure = Literal["unavailable", "blocked"]
TrackKind = Literal["manual", "auto"]


@dataclass(frozen=True)
class Track:
    lang: str
    kind: TrackKind
    vtt: str


@dataclass(frozen=True)
class Extraction:
    duration: float
    tracks: list[Track]


class Extractor:
    def extract(self, video_id: str) -> Extraction | Failure:
        raise NotImplementedError


class FakeExtractor(Extractor):
    def __init__(self, root: Path) -> None:
        self._root = root

    def extract(self, video_id: str) -> Extraction | Failure:
        directory = self._root / video_id
        if not directory.is_dir():
            return "unavailable"
        meta = json.loads((directory / "meta.json").read_text(encoding="utf-8"))
        status = meta.get("status")
        if status == "unavailable":
            return "unavailable"
        if status == "blocked":
            return "blocked"
        tracks: list[Track] = []
        for path in sorted(directory.glob("*.vtt")):
            lang, _, kind = path.name.removesuffix(".vtt").rpartition(".")
            if lang and kind in ("manual", "auto"):
                text = path.read_text(encoding="utf-8")
                tracks.append(
                    Track(lang, "manual" if kind == "manual" else "auto", text)
                )
        return Extraction(float(meta["duration"]), tracks)


def parse_delay(value: str) -> tuple[float, float]:
    low, _, high = value.partition("-")
    return float(low), float(high or low)


class YtDlpExtractor(Extractor):
    def __init__(
        self,
        delay: tuple[float, float] = (2.0, 5.0),
        yt_dlp: ModuleType | None = None,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        if yt_dlp is None:
            yt_dlp = importlib.import_module("yt_dlp")
        self._yt_dlp = yt_dlp
        self._delay = delay
        self._sleep = sleep

    def _wait(self) -> None:
        self._sleep(random.uniform(*self._delay))

    def extract(self, video_id: str) -> Extraction | Failure:
        options = {
            "skip_download": True,
            "writesubtitles": True,
            "writeautomaticsub": True,
            "subtitlesformat": "vtt",
            "quiet": True,
            "no_warnings": True,
        }
        try:
            with self._yt_dlp.YoutubeDL(options) as ydl:
                self._wait()
                info = ydl.extract_info(
                    f"https://www.youtube.com/watch?v={video_id}", download=False
                )
                tracks: list[Track] = []
                sources: list[tuple[str, TrackKind]] = [
                    ("subtitles", "manual"),
                    ("automatic_captions", "auto"),
                ]
                for field, kind in sources:
                    for lang, formats in (info.get(field) or {}).items():
                        for item in formats:
                            if item.get("ext") == "vtt":
                                self._wait()
                                body = ydl.urlopen(item["url"]).read()
                                tracks.append(Track(lang, kind, body.decode("utf-8")))
                                break
                return Extraction(float(info.get("duration") or 0), tracks)
        except self._yt_dlp.networking.exceptions.RequestError as error:
            if getattr(error, "status", None) in (403, 429):
                return "blocked"
            return "unavailable"
        except self._yt_dlp.utils.DownloadError as error:
            message = str(error)
            if "not a bot" in message or "Too Many Requests" in message:
                return "blocked"
            return "unavailable"


def make_extractor(environ: dict[str, str] | None = None) -> Extractor:
    env = os.environ if environ is None else environ
    if env.get("FETCHER_FAKE_YTDLP") == "1":
        directory = env.get("FAKE_YTDLP_DIR")
        if not directory:
            raise ValueError("FAKE_YTDLP_DIR is required with FETCHER_FAKE_YTDLP=1")
        return FakeExtractor(Path(directory))
    return YtDlpExtractor(parse_delay(env.get("YT_DELAY_SECONDS", "2-5")))


def choose_track(tracks: Sequence[Track], langs: Sequence[str]) -> Track | None:
    for kind in ("manual", "auto"):
        for lang in langs:
            for track in tracks:
                if track.kind == kind and track.lang == lang:
                    return track
    return None
