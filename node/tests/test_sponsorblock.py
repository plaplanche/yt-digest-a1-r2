import json
import socket
import threading
import urllib.request
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any
from urllib.parse import parse_qs, urlparse

import pytest
from yt_digest_node.sponsorblock import fetch_segments, sponsor_ratio
from yt_digest_node.vtt import Cue, clean_cues

VIDEO = "dQw4w9WgXcQ"
seen: list[str] = []
reply: dict[str, Any] = {}


class Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        seen.append(self.path)
        if "raw" in reply:
            self.wfile.write(reply["raw"])
            return
        body = reply["body"]
        self.send_response(reply["status"])
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: object) -> None:
        pass


@pytest.fixture
def server() -> Iterator[str]:
    seen.clear()
    reply.clear()
    httpd = HTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{httpd.server_port}"
    httpd.shutdown()
    httpd.server_close()


def log_line(capsys: pytest.CaptureFixture[str]) -> dict[str, Any]:
    line: dict[str, Any] = json.loads(capsys.readouterr().err)
    return line


def test_ok_returns_segments_and_logs(
    server: str, capsys: pytest.CaptureFixture[str]
) -> None:
    reply.update(
        status=200,
        body=json.dumps(
            [{"segment": [1, 2.5], "category": "sponsor"}, {"segment": [10, 12]}]
        ).encode(),
    )
    result = fetch_segments(server, VIDEO, "r1")
    assert (result.state, result.segments) == ("ok", [(1.0, 2.5), (10.0, 12.0)])
    url = urlparse(seen[0])
    assert url.path == "/api/skipSegments"
    assert parse_qs(url.query) == {
        "videoID": [VIDEO],
        "categories": ['["sponsor","selfpromo","interaction"]'],
    }
    assert "%5B%22sponsor%22" in url.query
    line = log_line(capsys)
    assert line["event"] == "sponsorblock.call"
    assert (line["video_id"], line["request_id"]) == (VIDEO, "r1")
    assert (line["attrs"]["status"], line["attrs"]["segments"]) == (200, 2)
    assert line["attrs"]["duration_ms"] >= 0


def test_404_is_none(server: str, capsys: pytest.CaptureFixture[str]) -> None:
    reply.update(status=404, body=b"Not Found")
    result = fetch_segments(server, VIDEO)
    assert (result.state, result.segments) == ("none", [])
    line = log_line(capsys)
    assert (line["attrs"]["status"], line["attrs"]["segments"]) == (404, 0)
    assert "request_id" not in line


def test_500_is_error(server: str, capsys: pytest.CaptureFixture[str]) -> None:
    reply.update(status=500, body=b"boom")
    result = fetch_segments(server, VIDEO)
    assert (result.state, result.segments) == ("error", [])
    line = log_line(capsys)
    assert (line["attrs"]["status"], line["attrs"]["segments"]) == (500, 0)


def test_malformed_200_is_error(
    server: str, capsys: pytest.CaptureFixture[str]
) -> None:
    reply.update(status=200, body=b"{not json")
    result = fetch_segments(server, VIDEO)
    assert (result.state, result.segments) == ("error", [])
    assert log_line(capsys)["attrs"]["segments"] == 0


def test_truncated_body_is_error(
    server: str, capsys: pytest.CaptureFixture[str]
) -> None:
    reply.update(raw=b"HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\n[{")
    result = fetch_segments(server, VIDEO)
    assert (result.state, result.segments) == ("error", [])
    line = log_line(capsys)
    assert (line["attrs"]["status"], line["attrs"]["segments"]) == (200, 0)


def test_garbage_status_line_is_error(
    server: str, capsys: pytest.CaptureFixture[str]
) -> None:
    reply.update(raw=b"garbage\r\n\r\n")
    result = fetch_segments(server, VIDEO)
    assert (result.state, result.segments) == ("error", [])
    line = log_line(capsys)
    assert (line["attrs"]["status"], line["attrs"]["segments"]) == (0, 0)


def test_non_finite_bounds_are_error(
    server: str, capsys: pytest.CaptureFixture[str]
) -> None:
    reply.update(status=200, body=b'[{"segment": [NaN, Infinity]}]')
    result = fetch_segments(server, VIDEO)
    assert (result.state, result.segments) == ("error", [])
    assert log_line(capsys)["attrs"]["segments"] == 0


def test_timeout_is_10_seconds(server: str, monkeypatch: pytest.MonkeyPatch) -> None:
    timeouts: list[float] = []
    real = urllib.request.urlopen

    def spy(url: str, timeout: float) -> Any:
        timeouts.append(timeout)
        return real(url, timeout=timeout)

    monkeypatch.setattr(urllib.request, "urlopen", spy)
    reply.update(status=404, body=b"")
    fetch_segments(server, VIDEO)
    assert timeouts == [10]


def test_connection_refused_is_error_with_status_0(
    capsys: pytest.CaptureFixture[str],
) -> None:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    result = fetch_segments(f"http://127.0.0.1:{port}", VIDEO)
    assert (result.state, result.segments) == ("error", [])
    line = log_line(capsys)
    assert (line["attrs"]["status"], line["attrs"]["segments"]) == (0, 0)


def test_midpoint_edges() -> None:
    cues = [Cue(0, 2, ("a",)), Cue(4, 6, ("b",))]
    # midpoint 1 is the segment start (inclusive): dropped
    assert clean_cues(cues, [(1.0, 3.0)]) == ["b"]
    # midpoint 1 is the segment end (exclusive): kept
    assert clean_cues(cues, [(0.0, 1.0)]) == ["a", "b"]


def test_ratio_without_segment_is_zero() -> None:
    assert sponsor_ratio([], 100) == 0


def test_ratio_unions_overlapping_segments() -> None:
    assert sponsor_ratio([(0, 10), (5, 15), (50, 60)], 100) == 0.25


def test_ratio_clips_to_the_duration() -> None:
    assert sponsor_ratio([(90, 500)], 100) == 0.1
    assert sponsor_ratio([(-20, 10)], 100) == 0.1
    assert sponsor_ratio([(150, 200)], 100) == 0


def test_ratio_rounds_to_3_decimals() -> None:
    assert sponsor_ratio([(0, 1)], 3) == 0.333
