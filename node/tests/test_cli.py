import json
import os
import subprocess
import sys
import threading
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import pytest
from yt_digest_node.contracts.log_event import LogEvent
from yt_digest_node.contracts.transcript_result import TranscriptResult

OK = "aaaaaaaaaaa"
BARE = "bbbbbbbbbbb"
GONE = "ccccccccccc"
BLOCKED = "ddddddddddd"
MISSING = "eeeeeeeeeee"

VTT = """WEBVTT

00:00:00.000 --> 00:00:02.000
Secret opening words.

00:00:02.000 --> 00:00:04.000
Buy this sponsor product.

00:00:04.000 --> 00:00:06.000
Closing secret words.
"""


class Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        self.send_response(200)
        self.end_headers()
        self.wfile.write(json.dumps([{"segment": [2, 4]}]).encode())

    def log_message(self, format: str, *args: object) -> None:
        pass


@pytest.fixture
def sponsorblock() -> Iterator[str]:
    httpd = HTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{httpd.server_port}"
    httpd.shutdown()


@pytest.fixture
def fixtures(tmp_path: Path) -> Path:
    def video(name: str, meta: dict[str, object], vtt: bool = False) -> None:
        directory = tmp_path / name
        directory.mkdir()
        (directory / "meta.json").write_text(json.dumps(meta))
        if vtt:
            (directory / "en.manual.vtt").write_text(VTT)

    video(OK, {"duration": 10}, vtt=True)
    video(BARE, {"duration": 10})
    video(GONE, {"duration": 10, "status": "unavailable"})
    video(BLOCKED, {"duration": 10, "status": "blocked"})
    return tmp_path


def run(
    fixtures: Path, sponsorblock: str, *args: str, **env: str
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, "-m", "yt_digest_node", "transcript", *args],
        check=False,
        capture_output=True,
        text=True,
        env={
            **os.environ,
            "FETCHER_FAKE_YTDLP": "1",
            "FAKE_YTDLP_DIR": str(fixtures),
            "SPONSORBLOCK_URL": sponsorblock,
            **env,
        },
    )


def logs(done: subprocess.CompletedProcess[str]) -> list[LogEvent]:
    return [LogEvent.model_validate_json(line) for line in done.stderr.splitlines()]


def test_ok_with_sponsor_cut(fixtures: Path, sponsorblock: str) -> None:
    done = run(fixtures, sponsorblock, OK, "--request-id", "req-1")
    assert done.returncode == 0
    result = TranscriptResult.model_validate_json(done.stdout)
    assert result.status == "ok"
    assert (result.lang, result.source) == ("en", "manual")
    assert result.pages == ["Secret opening words.\n\nClosing secret words."]
    assert result.word_count == 6
    assert not result.truncated
    assert result.sponsor_ratio == 0.2
    started, fetched = logs(done)[0], logs(done)[-1]
    assert started.event == "service.started"
    assert fetched.event == "fetch.transcript"
    assert fetched.video_id == OK
    assert fetched.request_id == "req-1"
    assert fetched.attrs["sponsorblock"] == "ok"
    assert fetched.attrs["words"] == 6
    assert "secret" not in done.stderr.lower()


def test_truncation_and_pages_from_environment(
    fixtures: Path, sponsorblock: str
) -> None:
    done = run(fixtures, sponsorblock, OK, MAX_WORDS="4", PAGE_WORDS="2")
    result = TranscriptResult.model_validate_json(done.stdout)
    assert result.truncated
    assert result.word_count == 4
    assert result.pages == ["Secret opening\n\n[…]", "secret words."]


def test_langs_option_and_no_transcript(fixtures: Path, sponsorblock: str) -> None:
    done = run(fixtures, sponsorblock, OK, "--langs", "de")
    result = TranscriptResult.model_validate_json(done.stdout)
    assert result.status == "no_transcript"
    assert result.pages == []
    assert result.sponsor_ratio is None
    assert done.returncode == 0


@pytest.mark.parametrize(
    ("video", "status"),
    [
        (BARE, "no_transcript"),
        (GONE, "unavailable"),
        (BLOCKED, "blocked"),
        (MISSING, "unavailable"),
    ],
)
def test_other_statuses(
    fixtures: Path, sponsorblock: str, video: str, status: str
) -> None:
    done = run(fixtures, sponsorblock, video)
    assert done.returncode == 0
    result = TranscriptResult.model_validate_json(done.stdout)
    assert result.status == status
    assert (result.word_count, result.truncated, result.lang) == (0, False, None)
    assert logs(done)[-1].attrs["outcome"] == status


def test_sponsorblock_failure_gives_null_ratio(fixtures: Path) -> None:
    done = run(fixtures, "http://127.0.0.1:1", OK)
    result = TranscriptResult.model_validate_json(done.stdout)
    assert result.status == "ok"
    assert result.sponsor_ratio is None
    assert logs(done)[-1].attrs["sponsorblock"] == "error"


@pytest.mark.parametrize("video", ["short", "bad id 0000", "../etc/passwd"])
def test_invalid_video_id(fixtures: Path, sponsorblock: str, video: str) -> None:
    done = run(fixtures, sponsorblock, video)
    assert done.returncode == 2
    assert done.stdout == ""
