import json
import shutil
import subprocess
from pathlib import Path

import pytest
from pydantic import ValidationError
from yt_digest_node.contracts.log_event import LogEvent
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
