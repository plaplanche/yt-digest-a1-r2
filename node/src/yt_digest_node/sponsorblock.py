import http.client
import json
import math
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Literal

from yt_digest_node.log import emit
from yt_digest_node.vtt import Segment

TIMEOUT_SECONDS = 10
CATEGORIES = ["sponsor", "selfpromo", "interaction"]

SponsorBlockState = Literal["ok", "none", "error"]


@dataclass(frozen=True)
class SponsorBlockResult:
    segments: list[Segment]
    state: SponsorBlockState


def _parse(body: bytes) -> list[Segment]:
    segments: list[Segment] = []
    for item in json.loads(body):
        start, end = item["segment"]
        start, end = float(start), float(end)
        if not (math.isfinite(start) and math.isfinite(end)):
            raise ValueError("non-finite segment bound")
        segments.append((start, end))
    return segments


def fetch_segments(
    base_url: str, video_id: str, request_id: str | None = None
) -> SponsorBlockResult:
    query = urllib.parse.urlencode(
        {
            "videoID": video_id,
            "categories": json.dumps(CATEGORIES, separators=(",", ":")),
        }
    )
    url = f"{base_url.rstrip('/')}/api/skipSegments?{query}"
    started = time.monotonic()
    status = 0
    segments: list[Segment] = []
    state: SponsorBlockState = "error"
    try:
        with urllib.request.urlopen(url, timeout=TIMEOUT_SECONDS) as response:
            status = response.status
            if status == 200:
                segments = _parse(response.read())
                state = "ok"
    except urllib.error.HTTPError as error:
        status = error.code
        error.close()
        if status == 404:
            state = "none"
    except (OSError, http.client.HTTPException, ValueError, KeyError, TypeError):
        # network error, malformed JSON or unexpected item shape
        segments = []
        state = "error"
    fields: dict[str, str] = {"video_id": video_id}
    if request_id is not None:
        fields["request_id"] = request_id
    emit(
        "sponsorblock.call",
        level="info" if state != "error" else "warn",
        attrs={
            "status": status,
            "segments": len(segments),
            "duration_ms": round((time.monotonic() - started) * 1000),
        },
        **fields,
    )
    return SponsorBlockResult(segments, state)


def sponsor_ratio(segments: list[Segment], duration: float) -> float:
    """Length of the union of the segments clipped to [0, duration], over the duration."""
    if duration <= 0:
        return 0.0
    clipped = sorted(
        (max(0.0, start), min(duration, end))
        for start, end in segments
        if min(duration, end) > max(0.0, start)
    )
    covered = 0.0
    reach = 0.0
    for start, end in clipped:
        start = max(start, reach)
        if end > start:
            covered += end - start
            reach = end
    return round(covered / duration, 3)
