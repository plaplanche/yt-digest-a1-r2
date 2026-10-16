import json
from typing import Any

import pytest
from yt_digest_node.log import emit


def test_emit_writes_one_json_line(capsys: pytest.CaptureFixture[str]) -> None:
    emit("service.started", attrs={"version": "0.1.0"})
    err = capsys.readouterr().err
    assert err.endswith("\n")
    line = json.loads(err)
    assert line["event"] == "service.started"
    assert line["service"] == "node"
    assert line["level"] == "info"
    assert line["attrs"] == {"version": "0.1.0"}
    assert line["ts"].endswith("Z")


def test_emit_keeps_optional_fields(capsys: pytest.CaptureFixture[str]) -> None:
    emit("fetch.transcript", level="warn", video_id="dQw4w9WgXcQ", request_id="r1")
    line = json.loads(capsys.readouterr().err)
    assert (line["level"], line["video_id"], line["request_id"]) == (
        "warn",
        "dQw4w9WgXcQ",
        "r1",
    )


def test_emit_rejects_an_event_outside_the_catalogue(
    capsys: pytest.CaptureFixture[str],
) -> None:
    with pytest.raises(ValueError):
        emit("not.catalogued")
    assert capsys.readouterr().err == ""


@pytest.mark.parametrize("name", ["extra", "ts", "service"])
def test_emit_rejects_an_unknown_field(name: str) -> None:
    fields: dict[str, Any] = {name: "x"}
    with pytest.raises(ValueError):
        emit("service.started", **fields)


def test_emit_rejects_a_bad_level() -> None:
    with pytest.raises(ValueError):
        emit("service.started", level="fatal")
