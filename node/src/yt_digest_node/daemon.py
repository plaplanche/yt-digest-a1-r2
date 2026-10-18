"""The node daemon (lot 2 section 9): heartbeat, claim, pipeline, result."""

import signal
import sys
import threading
import time
from importlib.metadata import version

from yt_digest_node.cli import run
from yt_digest_node.contracts.node_claim_request import NodeClaimRequest
from yt_digest_node.contracts.node_claim_response import NodeClaimResponse
from yt_digest_node.contracts.node_heartbeat_request import NodeHeartbeatRequest
from yt_digest_node.contracts.node_heartbeat_response import NodeHeartbeatResponse
from yt_digest_node.contracts.node_job_ack import NodeJobAck
from yt_digest_node.contracts.node_release_request import NodeReleaseRequest
from yt_digest_node.contracts.node_result_request import NodeResultRequest
from yt_digest_node.log import emit
from yt_digest_node.worker_client import CallFailed, Unauthorized, WorkerClient


class Daemon:
    def __init__(
        self,
        client: WorkerClient,
        env: dict[str, str],
        langs: list[str],
        claim_batch: int,
        poll_seconds: float,
        heartbeat_seconds: float,
        stop: threading.Event,
    ) -> None:
        self._client = client
        self._env = env
        self._langs = langs
        self._claim_batch = claim_batch
        self._poll_seconds = poll_seconds
        self._heartbeat_seconds = heartbeat_seconds
        self._stop = stop
        self._started = time.monotonic()
        self._last_heartbeat: float | None = None
        self._in_progress = 0

    def _heartbeat(self) -> None:
        self._client.call(
            "heartbeat",
            NodeHeartbeatRequest(
                version=version("yt-digest-node"),
                uptime_s=int(time.monotonic() - self._started),
                jobs_in_progress=self._in_progress,
            ),
            NodeHeartbeatResponse,
        )
        self._last_heartbeat = time.monotonic()

    def _heartbeat_if_due(self) -> None:
        last = self._last_heartbeat
        if last is None or time.monotonic() - last >= self._heartbeat_seconds:
            self._heartbeat()

    def _process(self, video_id: str, lease_id: str) -> None:
        try:
            result = run(video_id, self._langs, None, self._env)
            request = NodeResultRequest(
                lease_id=lease_id,
                outcome=result.status,
                transcript=result if result.status == "ok" else None,
            )
        except Exception:  # noqa: BLE001 - any pipeline failure is reported as outcome error
            request = NodeResultRequest(
                lease_id=lease_id, outcome="error", transcript=None
            )
        self._client.call("result", request, NodeJobAck, video_id, retry=True)

    def _release(self, video_id: str, lease_id: str) -> None:
        self._client.call(
            "release",
            NodeReleaseRequest(lease_id=lease_id),
            NodeJobAck,
            video_id,
            retry=True,
        )

    def _handle_job(self, video_id: str, lease_id: str) -> None:
        """Runs or releases one job; a failed call is dropped, the lease expiry recovers the job."""
        try:
            if self._stop.is_set():
                self._release(video_id, lease_id)
            else:
                self._process(video_id, lease_id)
        except CallFailed:
            pass

    def cycle(self) -> int:
        """One heartbeat-if-due and claim; returns the number of jobs claimed."""
        self._heartbeat_if_due()
        claim = self._client.call(
            "claim", NodeClaimRequest(max_jobs=self._claim_batch), NodeClaimResponse
        )
        remaining = len(claim.jobs)
        for job in claim.jobs:
            self._in_progress = remaining
            if not self._stop.is_set():
                try:
                    self._heartbeat_if_due()
                except CallFailed:
                    pass
            self._handle_job(job.video_id, job.lease_id)
            remaining -= 1
        self._in_progress = 0
        return len(claim.jobs)

    def work(self, once: bool) -> int:
        try:
            if once:
                self._heartbeat()
                self.cycle()
                return 0
            while not self._stop.is_set():
                try:
                    claimed = self.cycle()
                except CallFailed:
                    claimed = 0
                if claimed == 0:
                    self._stop.wait(self._poll_seconds)
            return 0
        except Unauthorized:
            return 1
        except CallFailed:
            return 1


def _number(
    env: dict[str, str], name: str, default: str, low: float, high: float
) -> float:
    value = float(env.get(name, default))
    if not low <= value <= high:
        raise ValueError(f"{name} must be between {low:g} and {high:g}")
    return value


def work(once: bool, langs: list[str], env: dict[str, str]) -> int:
    url = env.get("WORKER_URL", "")
    token = env.get("NODE_TOKEN", "")
    if not url or not token:
        print("yt-digest-node: WORKER_URL and NODE_TOKEN are required", file=sys.stderr)
        return 2
    try:
        batch = int(_number(env, "CLAIM_BATCH", "3", 1, 10))
        poll = _number(env, "POLL_SECONDS", "10", 0, float("inf"))
        beat = _number(env, "HEARTBEAT_SECONDS", "60", 0, float("inf"))
    except ValueError as error:
        print(f"yt-digest-node: {error}", file=sys.stderr)
        return 2
    stop = threading.Event()
    for number in (signal.SIGTERM, signal.SIGINT):
        signal.signal(number, lambda *_: stop.set())
    emit("service.started", attrs={"version": version("yt-digest-node")})
    daemon = Daemon(WorkerClient(url, token), env, langs, batch, poll, beat, stop)
    return daemon.work(once)
