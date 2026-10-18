"""HTTP client of the node protocol (lot 2 section 8): one JSON POST per call, retries for results."""

import json
import time
import urllib.error
import urllib.request
from dataclasses import dataclass

from pydantic import BaseModel

from yt_digest_node.log import emit

RETRY_DELAYS = (1, 2, 4)
TIMEOUT_SECONDS = 30


class Unauthorized(Exception):
    """The Worker answered 401: the node token is refused."""


class CallFailed(Exception):
    """A call ended without a usable 2xx answer (network error, non-2xx, or an invalid body)."""


@dataclass(frozen=True)
class Reply:
    status: int
    body: bytes


def sleep(seconds: float) -> None:
    time.sleep(seconds)


class WorkerClient:
    def __init__(self, base_url: str, token: str) -> None:
        self._base_url = base_url.rstrip("/")
        self._token = token

    def _post(self, endpoint: str, body: str, video_id: str | None) -> Reply:
        request = urllib.request.Request(
            f"{self._base_url}/node/{endpoint}",
            data=body.encode(),
            method="POST",
            headers={
                "Authorization": f"Bearer {self._token}",
                "Content-Type": "application/json",
            },
        )
        started = time.monotonic()
        status = 0
        data = b""
        try:
            with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
                status = response.status
                data = response.read()
        except urllib.error.HTTPError as error:
            status = error.code
            data = error.read()
        except (OSError, ValueError):
            status = 0
        ids = {} if video_id is None else {"video_id": video_id}
        emit(
            "worker.call",
            attrs={
                "endpoint": endpoint,
                "status": status,
                "duration_ms": round((time.monotonic() - started) * 1000),
            },
            **ids,
        )
        if status == 401:
            raise Unauthorized
        return Reply(status, data)

    def call[T: BaseModel](
        self,
        endpoint: str,
        request: BaseModel,
        response: type[T],
        video_id: str | None = None,
        retry: bool = False,
    ) -> T:
        """Posts `request`; with `retry`, a network error or a 5xx is retried after 1, 2 and 4 s."""
        body = request.model_dump_json(exclude_none=endpoint == "heartbeat")
        delays = iter(RETRY_DELAYS if retry else ())
        while True:
            reply = self._post(endpoint, body, video_id)
            if reply.status == 0 or reply.status >= 500:
                delay = next(delays, None)
                if delay is not None:
                    sleep(delay)
                    continue
            if not 200 <= reply.status < 300:
                raise CallFailed(f"{endpoint}: status {reply.status}")
            try:
                return response.model_validate(json.loads(reply.body))
            except ValueError as error:
                raise CallFailed(f"{endpoint}: invalid response") from error
