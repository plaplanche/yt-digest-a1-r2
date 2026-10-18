import json
import shutil
import subprocess
from pathlib import Path

import pytest
from pydantic import BaseModel, ValidationError
from yt_digest_node.contracts.error import ErrorResponse
from yt_digest_node.contracts.log_event import LogEvent
from yt_digest_node.contracts.node_claim_request import NodeClaimRequest
from yt_digest_node.contracts.node_claim_response import NodeClaimResponse
from yt_digest_node.contracts.node_heartbeat_request import NodeHeartbeatRequest
from yt_digest_node.contracts.node_heartbeat_response import NodeHeartbeatResponse
from yt_digest_node.contracts.node_job_ack import NodeJobAck
from yt_digest_node.contracts.node_release_request import NodeReleaseRequest
from yt_digest_node.contracts.node_result_request import NodeResultRequest
from yt_digest_node.contracts.transcript_result import TranscriptResult

REPO = Path(__file__).resolve().parents[2]
GENERATED = [
    "worker/src/contracts/log-event.ts",
    "node/src/yt_digest_node/contracts/log_event.py",
]

VALID_RESULT: dict[str, object] = {
    "video_id": "dQw4w9WgXcQ",
    "status": "ok",
    "lang": "en",
    "source": "manual",
    "word_count": 3,
    "truncated": False,
    "sponsor_ratio": 0.25,
    "pages": ["one two three"],
}

VALID_LOG: dict[str, object] = {
    "ts": "2026-10-16T12:00:00.000Z",
    "level": "info",
    "service": "node",
    "event": "service.started",
    "attrs": {"version": "0.1.0"},
}


def test_valid_result_is_accepted() -> None:
    result = TranscriptResult.model_validate_json(json.dumps(VALID_RESULT))
    assert result.status == "ok"


def test_result_without_transcript_is_accepted() -> None:
    data = {**VALID_RESULT, "status": "blocked", "lang": None, "source": None}
    data |= {"word_count": 0, "sponsor_ratio": None, "pages": []}
    assert TranscriptResult.model_validate_json(json.dumps(data)).lang is None


@pytest.mark.parametrize(
    "change",
    [
        {"extra": 1},
        {"video_id": "short"},
        {"video_id": "dQw4w9WgXcQ\n"},
        {"status": "done"},
        {"source": "other"},
        {"word_count": -1},
        {"sponsor_ratio": 1.5},
        {"pages": "text"},
    ],
)
def test_invalid_result_is_rejected(change: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        TranscriptResult.model_validate_json(json.dumps({**VALID_RESULT, **change}))


def test_valid_log_line_is_accepted() -> None:
    assert (
        LogEvent.model_validate_json(json.dumps(VALID_LOG)).event == "service.started"
    )


@pytest.mark.parametrize(
    "change",
    [
        {"event": "unknown.event"},
        {"extra": 1},
        {"level": "fatal"},
        {"ts": "2026-10-16 12:00:00"},
        {"request_id": None},
        {"video_id": None},
    ],
)
def test_invalid_log_line_is_rejected(change: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        LogEvent.model_validate_json(json.dumps({**VALID_LOG, **change}))


@pytest.fixture
def repo_copy(tmp_path: Path) -> Path:
    for name in (
        "contracts",
        "scripts",
        "worker/src/contracts",
        "node/src/yt_digest_node/contracts",
    ):
        shutil.copytree(
            REPO / name, tmp_path / name, ignore=shutil.ignore_patterns("__pycache__")
        )
    return tmp_path


def check(root: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [str(root / "scripts/contracts.sh"), "--check"],
        check=False,
        capture_output=True,
        text=True,
        cwd=root,
    )


def test_check_passes_on_committed_files(repo_copy: Path) -> None:
    assert check(repo_copy).returncode == 0


@pytest.mark.parametrize("name", GENERATED)
def test_check_fails_when_a_generated_file_is_edited(
    repo_copy: Path, name: str
) -> None:
    with (repo_copy / name).open("a") as f:
        f.write("// hand edit\n")
    result = check(repo_copy)
    assert result.returncode == 1
    assert name in result.stderr


def test_check_fails_when_a_schema_changes(repo_copy: Path) -> None:
    path = repo_copy / "contracts/log-event.schema.json"
    path.write_text(
        path.read_text().replace('"sponsorblock.call"', '"sponsorblock.call", "x.y"')
    )
    result = check(repo_copy)
    assert result.returncode == 1
    assert "worker/src/contracts/log-event.ts" in result.stderr
    assert "node/src/yt_digest_node/contracts/log_event.py" in result.stderr


def test_generate_survives_pycache_and_matches_check(repo_copy: Path) -> None:
    cache = repo_copy / "node/src/yt_digest_node/contracts/__pycache__"
    cache.mkdir()
    (cache / "x.pyc").write_bytes(b"")
    (repo_copy / GENERATED[0]).write_text("// stale\n")
    result = subprocess.run(
        [str(repo_copy / "scripts/contracts.sh")],
        check=False,
        capture_output=True,
        text=True,
        cwd=repo_copy,
    )
    assert result.returncode == 0, result.stderr
    assert cache.is_dir()
    assert check(repo_copy).returncode == 0


TS = "2026-10-16T07:00:01.123Z"
LEASE = "0123456789abcdef"

PROTOCOL_VALID: list[tuple[type[BaseModel], dict[str, object]]] = [
    (
        NodeHeartbeatRequest,
        {
            "version": "0.1.0",
            "uptime_s": 5,
            "jobs_in_progress": 0,
            "last_success_at": TS,
            "last_blocked_at": None,
            "disk_free_ratio": 0.5,
            "cpu_temp_c": 48.5,
        },
    ),
    (
        NodeHeartbeatResponse,
        {
            "node_id": "n1",
            "state": "healthy",
            "hourly_budget": 10,
            "directive": "run",
        },
    ),
    (NodeClaimRequest, {"max_jobs": 3}),
    (NodeClaimRequest, {}),
    (
        NodeClaimResponse,
        {
            "jobs": [
                {
                    "video_id": "dQw4w9WgXcQ",
                    "lease_id": LEASE,
                    "lease_expires_at": TS,
                }
            ]
        },
    ),
    (NodeResultRequest, {"lease_id": "l", "outcome": "ok", "transcript": VALID_RESULT}),
    (NodeResultRequest, {"lease_id": "l", "outcome": "error", "transcript": None}),
    (NodeReleaseRequest, {"lease_id": "l"}),
    (NodeJobAck, {"video_id": "dQw4w9WgXcQ", "status": "failed_video"}),
    (ErrorResponse, {"error": {"code": "not_found", "message": "no such job"}}),
]


@pytest.mark.parametrize(("model", "data"), PROTOCOL_VALID)
def test_valid_protocol_instance_is_accepted(
    model: type[BaseModel], data: dict[str, object]
) -> None:
    model.model_validate_json(json.dumps(data))


HEARTBEAT: dict[str, object] = PROTOCOL_VALID[0][1]
CLAIMED: dict[str, object] = {
    "video_id": "dQw4w9WgXcQ",
    "lease_id": LEASE,
    "lease_expires_at": TS,
}
RESULT: dict[str, object] = {
    "lease_id": "l",
    "outcome": "ok",
    "transcript": VALID_RESULT,
}

PROTOCOL_INVALID: list[tuple[type[BaseModel], dict[str, object]]] = [
    (NodeHeartbeatRequest, {**HEARTBEAT, "extra": 1}),
    (NodeHeartbeatRequest, {k: v for k, v in HEARTBEAT.items() if k != "version"}),
    (NodeHeartbeatRequest, {**HEARTBEAT, "version": ""}),
    (NodeHeartbeatRequest, {**HEARTBEAT, "version": "x" * 65}),
    (NodeHeartbeatRequest, {**HEARTBEAT, "last_success_at": "yesterday"}),
    (NodeHeartbeatRequest, {**HEARTBEAT, "disk_free_ratio": 1.5}),
    (
        NodeHeartbeatResponse,
        {"node_id": "n", "state": "x", "hourly_budget": 1, "directive": "run"},
    ),
    (NodeClaimRequest, {"max_jobs": 0}),
    (NodeClaimRequest, {"max_jobs": 11}),
    (NodeClaimRequest, {"extra": 1}),
    (NodeClaimResponse, {"jobs": [{**CLAIMED, "lease_id": "short"}]}),
    (NodeClaimResponse, {"jobs": [{**CLAIMED, "extra": 1}]}),
    (NodeResultRequest, {**RESULT, "extra": 1}),
    (NodeResultRequest, {**RESULT, "outcome": "done"}),
    (NodeResultRequest, {**RESULT, "transcript": {**VALID_RESULT, "extra": 1}}),
    (NodeResultRequest, {**RESULT, "transcript": {**VALID_RESULT, "status": "error"}}),
    (NodeResultRequest, {"lease_id": "l", "outcome": "ok"}),
    (NodeReleaseRequest, {"lease_id": ""}),
    (NodeJobAck, {"video_id": "dQw4w9WgXcQ", "status": "other"}),
    (ErrorResponse, {"error": {"code": "c", "message": "m", "extra": 1}}),
    (ErrorResponse, {"error": {"code": "c"}}),
]


@pytest.mark.parametrize(("model", "data"), PROTOCOL_INVALID)
def test_invalid_protocol_instance_is_rejected(
    model: type[BaseModel], data: dict[str, object]
) -> None:
    with pytest.raises(ValidationError):
        model.model_validate_json(json.dumps(data))


def test_result_request_uses_the_generated_transcript_result_type() -> None:
    annotation = NodeResultRequest.model_fields["transcript"].annotation
    assert annotation == TranscriptResult | None
    source = (
        REPO / "node/src/yt_digest_node/contracts/node_result_request.py"
    ).read_text()
    assert "class TranscriptResult" not in source


def test_lot_2_events_are_in_the_catalogue() -> None:
    line = {**VALID_LOG, "service": "worker", "event": "job.claimed"}
    assert LogEvent.model_validate_json(json.dumps(line)).event == "job.claimed"
