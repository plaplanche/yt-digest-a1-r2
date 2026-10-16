"""Structured logger: one JSON line per event on standard error, catalogued events only."""

import sys
from datetime import UTC, datetime

from yt_digest_node.contracts.log_event import LogEvent, LogEventName


def emit(event: str, level: str = "info", **fields: object) -> None:
    """Writes one log line; raises ValueError on an uncatalogued event or an unknown field."""
    for name in ("ts", "service"):
        if name in fields:
            raise ValueError(f"log field {name} is set by the logger")
    now = datetime.now(UTC).isoformat(timespec="milliseconds")
    line = LogEvent.model_validate(
        {
            "ts": now.replace("+00:00", "Z"),
            "level": level,
            "service": "node",
            "event": LogEventName(event),
            "attrs": {},
            **fields,
        }
    )
    sys.stderr.write(line.model_dump_json(exclude_unset=True) + "\n")
