import json
import os
import signal
import subprocess
import sys
import threading
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import pytest
from yt_digest_node.contracts.log_event import LogEvent
from yt_digest_node.contracts.node_claim_request import NodeClaimRequest
from yt_digest_node.contracts.node_heartbeat_request import NodeHeartbeatRequest
from yt_digest_node.contracts.node_release_request import NodeReleaseRequest
from yt_digest_node.contracts.node_result_request import NodeResultRequest

TOKEN = "secret-node-token-123"
OK = "aaaaaaaaaaa"
GONE = "ccccccccccc"
VTT = "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nHello brave world.\n"


class FakeWorker:
    def __init__(self) -> None:
        self.requests: list[tuple[str, dict[str, object]]] = []
        self.jobs: list[str] = []
        self.statuses: dict[str, list[int]] = {}
        self.on_result: list[object] = []
        self.pid: int | None = None
        worker = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self) -> None:
                body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                endpoint = self.path.removeprefix("/node/")
                assert self.headers["Authorization"] == f"Bearer {TOKEN}"
                worker.requests.append((endpoint, body))
                queue = worker.statuses.get(endpoint, [])
                status = queue.pop(0) if queue else 200
                if endpoint == "result" and worker.pid is not None and status == 200:
                    os.kill(worker.pid, signal.SIGTERM)
                    worker.pid = None
                payload: dict[str, object] = {"error": {"code": "x", "message": "x"}}
                if status == 200:
                    payload = self.ok(endpoint, body)
                data = json.dumps(payload).encode()
                self.send_response(status)
                self.end_headers()
                self.wfile.write(data)

            def ok(self, endpoint: str, body: dict[str, object]) -> dict[str, object]:
                if endpoint == "heartbeat":
                    return {
                        "node_id": "n",
                        "state": "healthy",
                        "hourly_budget": 10,
                        "directive": "run",
                    }
                if endpoint == "claim":
                    jobs, worker.jobs = worker.jobs, []
                    return {
                        "jobs": [
                            {
                                "video_id": video,
                                "lease_id": f"lease-{video}-0123456789",
                                "lease_expires_at": "2026-10-16T07:00:01.123Z",
                            }
                            for video in jobs
                        ]
                    }
                lease = str(body["lease_id"])
                video = lease.split("-")[1]
                status = "queued" if endpoint == "release" else "done"
                return {"video_id": video, "status": status}

            def log_message(self, format: str, *args: object) -> None:
                pass

        self.httpd = HTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.httpd.server_port}"
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def sent(self, endpoint: str) -> list[dict[str, object]]:
        return [body for name, body in self.requests if name == endpoint]


@pytest.fixture
def worker() -> Iterator[FakeWorker]:
    fake = FakeWorker()
    yield fake
    fake.httpd.shutdown()


@pytest.fixture
def fixtures(tmp_path: Path) -> Path:
    for name, meta in (
        (OK, {"duration": 10}),
        (GONE, {"duration": 1, "status": "unavailable"}),
    ):
        (tmp_path / name).mkdir()
        (tmp_path / name / "meta.json").write_text(json.dumps(meta))
    (tmp_path / OK / "en.manual.vtt").write_text(VTT)
    return tmp_path


def env(fixtures: Path, worker: FakeWorker, **extra: str) -> dict[str, str]:
    base = {
        **os.environ,
        "FETCHER_FAKE_YTDLP": "1",
        "FAKE_YTDLP_DIR": str(fixtures),
        "SPONSORBLOCK_URL": "http://127.0.0.1:1",
        "WORKER_URL": worker.url,
        "NODE_TOKEN": TOKEN,
        "POLL_SECONDS": "0.1",
    }
    return {**base, **extra}


def start(
    fixtures: Path, worker: FakeWorker, *args: str, **extra: str
) -> subprocess.Popen[str]:
    return subprocess.Popen(
        [sys.executable, "-m", "yt_digest_node", "work", *args],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        env=env(fixtures, worker, **extra),
    )


def finish(proc: subprocess.Popen[str]) -> tuple[int, list[LogEvent], str]:
    _, err = proc.communicate(timeout=60)
    return (
        proc.returncode,
        [LogEvent.model_validate_json(x) for x in err.splitlines()],
        err,
    )


def test_once_sends_heartbeat_claim_and_results(
    fixtures: Path, worker: FakeWorker
) -> None:
    worker.jobs = [OK, GONE]
    code, events, err = finish(start(fixtures, worker, "--once", CLAIM_BATCH="2"))
    assert code == 0
    assert [name for name, _ in worker.requests] == [
        "heartbeat",
        "claim",
        "result",
        "result",
    ]
    heartbeat = NodeHeartbeatRequest.model_validate(worker.sent("heartbeat")[0])
    assert heartbeat.jobs_in_progress == 0
    assert NodeClaimRequest.model_validate(worker.sent("claim")[0]).max_jobs == 2
    first, second = (NodeResultRequest.model_validate(x) for x in worker.sent("result"))
    assert (first.outcome, second.outcome) == ("ok", "unavailable")
    assert first.lease_id == f"lease-{OK}-0123456789"
    assert first.transcript is not None
    assert first.transcript.video_id == OK
    assert first.transcript.pages == ["Hello brave world."]
    assert second.transcript is None
    assert events[0].event == "service.started"
    calls = [e for e in events if e.event == "worker.call"]
    assert [c.attrs["endpoint"] for c in calls] == [
        "heartbeat",
        "claim",
        "result",
        "result",
    ]
    assert all(c.attrs["status"] == 200 for c in calls)
    assert calls[2].video_id == OK
    assert [e.event.value for e in events].count("fetch.transcript") == 2
    assert TOKEN not in err
    assert "brave" not in err


def test_pipeline_exception_sends_error(fixtures: Path, worker: FakeWorker) -> None:
    worker.jobs = [OK]
    code, _, _ = finish(start(fixtures, worker, "--once", MAX_WORDS="many"))
    assert code == 0
    result = NodeResultRequest.model_validate(worker.sent("result")[0])
    assert (result.outcome, result.transcript) == ("error", None)


def test_result_503_is_retried(fixtures: Path, worker: FakeWorker) -> None:
    worker.jobs = [GONE]
    worker.statuses["result"] = [503]
    code, events, _ = finish(start(fixtures, worker, "--once"))
    assert code == 0
    assert len(worker.sent("result")) == 2
    statuses = [
        e.attrs["status"] for e in events if e.attrs.get("endpoint") == "result"
    ]
    assert statuses == [503, 200]


def test_result_409_is_not_retried(fixtures: Path, worker: FakeWorker) -> None:
    worker.jobs = [GONE]
    worker.statuses["result"] = [409]
    code, _, _ = finish(start(fixtures, worker, "--once"))
    assert code == 0
    assert len(worker.sent("result")) == 1


def test_failed_claim_exits_1(fixtures: Path, worker: FakeWorker) -> None:
    worker.statuses["claim"] = [500]
    code, _, _ = finish(start(fixtures, worker, "--once"))
    assert code == 1


def test_unauthorized_exits_1(fixtures: Path, worker: FakeWorker) -> None:
    worker.statuses["heartbeat"] = [401]
    code, _, err = finish(start(fixtures, worker, "--once"))
    assert code == 1
    assert TOKEN not in err


@pytest.mark.parametrize("missing", ["NODE_TOKEN", "WORKER_URL"])
def test_missing_variable_exits_2(
    fixtures: Path, worker: FakeWorker, missing: str
) -> None:
    proc = subprocess.run(
        [sys.executable, "-m", "yt_digest_node", "work", "--once"],
        check=False,
        capture_output=True,
        text=True,
        env={k: v for k, v in env(fixtures, worker).items() if k != missing},
    )
    assert proc.returncode == 2
    assert worker.requests == []


def test_sigterm_releases_unstarted_jobs(fixtures: Path, worker: FakeWorker) -> None:
    worker.jobs = [OK, GONE]
    proc = start(fixtures, worker, CLAIM_BATCH="2")
    worker.pid = proc.pid
    code, events, err = finish(proc)
    assert code == 0
    assert [name for name, _ in worker.requests[:4]] == [
        "heartbeat",
        "claim",
        "result",
        "release",
    ]
    release = NodeReleaseRequest.model_validate(worker.sent("release")[0])
    assert release.lease_id == f"lease-{GONE}-0123456789"
    assert [e.event.value for e in events].count("fetch.transcript") == 1
    assert TOKEN not in err
