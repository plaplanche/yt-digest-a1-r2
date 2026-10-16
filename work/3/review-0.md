# Review 0

- Reviewed commit: `3582153dd76e413160439d66bd0198dfec2d4960`
- Reviewer model: claude-opus-5-5
- Verdict: **no-go** (the reviewer answered no-go)

## Findings

- **blocking** (`scripts/contracts_gen.py:167`) Regeneration crashes on __pycache__ after any test run, leaving the generated tree half-deleted

  In generate mode, `main` calls `old.unlink()` on every entry of `(ROOT / directory).glob("*")`. Nothing in the repo turns off bytecode writing: there is no PYTHONDONTWRITEBYTECODE, and `scripts/checks/test-node.sh` runs pytest as usual. So once the tests have imported `yt_digest_node.contracts.*`, `node/src/yt_digest_node/contracts/__pycache__/` exists. Running `./scripts/contracts.sh` then hits that directory, and `Path.unlink()` fails on it with IsADirectoryError (or PermissionError). Glob order is arbitrary, so some generated files may already be deleted when it fails, which leaves the package broken. This is the main command of section 4.3, and the stale-file message itself tells developers to run it ("run ./scripts/contracts.sh to regenerate"). The `--check` path filters with `is_file()` and the test fixture copies with `ignore_patterns("__pycache__")`, which is why CI stays green. No test runs generate mode at all. Fix: delete only regular files, or only the files the generator owns. Add a test that runs `contracts.sh` (no args) in the repo copy with a `__pycache__` present, then checks that `--check` passes.

- **minor** (`node/src/yt_digest_node/contracts/log_event.py:24`) Optional log fields accept null in Python but not in the schema

  The schema types `request_id` as `{"type": "string"}` and `video_id` as a string with a pattern. Neither is nullable. The generator still emits `str | None = Field(default=None)`, so `LogEvent.model_validate_json('{..., "request_id": null}')` passes in Python while the schema (ajv) rejects it. The two languages disagree on the shared contract. A cleaner way to express "optional" is to leave the key out rather than allow null. This choice is also not in docs/decisions.md.

- **minor** (`worker/src/log.ts:22`) TypeScript logger does not validate field values at runtime the way the Python one does

  `emit` in Python validates the whole line against the generated model: the `video_id` pattern, `attrs` must be an object, `request_id` must be a string. `log()` in TypeScript only checks the event, field names and level at runtime. A call that gets past the types (from JS, or with a cast) can write a line that breaks the schema, for example `video_id: "bad"`. Section 4.4 only requires the rejection of unknown events and fields, and decisions.md records this, so this is minor. It is still a gap between the two loggers.

- **minor** (`scripts/contracts.sh:7`) Generator interpreter is not pinned

  `uv run --no-project python` does not ask for a Python version, so uv uses whatever interpreter it finds first. The generator needs Python 3.10 or newer (it uses `str | None` in annotations that are evaluated at runtime, and `removesuffix`). Also, the generated Python output is formatted to match ruff's layout by a hand-coded 88-column rule. Adding `--python 3.12` would make the script match the spec's environment.

- **minor** (`worker/tests/contracts.test.ts:22`) Worker contract tests exercise the schema files, not the generated TypeScript

  The TypeScript rejection tests run ajv on `contracts/*.schema.json`. They would still pass if `worker/src/contracts/*.ts` were wrong. Type-level coverage of the generated types is limited to `validResult` being typed as `TranscriptResult`. decisions.md records this and it meets the letter of the acceptance criterion, but it is weaker than it looks.

- **blocking** Definition of done not met: The change does what the ticket and spec/lot-1.md say, and nothing more.

  The schemas match sections 4.1 and 4.2. `--check` regenerates into a temp dir and names the stale files. The models, StrEnum, TS union and both loggers are present. However, the main generate mode of `./scripts/contracts.sh` (section 4.3) fails once `__pycache__` exists in the Python contracts directory, which happens after every test-node run (scripts/contracts_gen.py:167). There is no scope creep beyond the ajv dev dependency, which is documented.

- **blocking** Definition of done not met: The change is covered by tests that fail without it.

  Both languages have tests for accepting and rejecting results and log lines, the logger tests check that an uncatalogued event raises or throws, and the stale-check tests cover a hand edit and a schema change. All of these are new code, so they fail without the change. Generate mode (`contracts.sh` without `--check`) has no test at all, which is how the __pycache__ crash got through. The TS rejection tests validate the schema files rather than the generated TS.

- **blocking** Definition of done not met: Every choice the spec leaves open is written down in docs/decisions.md.

  Three dated lines cover: the hand-written stdlib generator, Pydantic strict mode with extra=forbid, the logger setting ts and service itself, using ajv for worker tests, and the limited runtime check in TS. Not recorded: making the optional `request_id` and `video_id` nullable in Python (the schema does not allow null), dropping None on output (`exclude_none`), and generating the TS union as a `LOG_EVENT_NAMES` const array.

## Definition of done

- met: check lint passes

  Replayed by Ariane: exit 0.

- met: check contracts passes

  Replayed by Ariane: exit 0.

- met: check test-node passes

  Replayed by Ariane: exit 0.

- met: check test-worker passes

  Replayed by Ariane: exit 0.

- **not met**: The change does what the ticket and spec/lot-1.md say, and nothing more.

  The schemas match sections 4.1 and 4.2. `--check` regenerates into a temp dir and names the stale files. The models, StrEnum, TS union and both loggers are present. However, the main generate mode of `./scripts/contracts.sh` (section 4.3) fails once `__pycache__` exists in the Python contracts directory, which happens after every test-node run (scripts/contracts_gen.py:167). There is no scope creep beyond the ajv dev dependency, which is documented.

- **not met**: The change is covered by tests that fail without it.

  Both languages have tests for accepting and rejecting results and log lines, the logger tests check that an uncatalogued event raises or throws, and the stale-check tests cover a hand edit and a schema change. All of these are new code, so they fail without the change. Generate mode (`contracts.sh` without `--check`) has no test at all, which is how the __pycache__ crash got through. The TS rejection tests validate the schema files rather than the generated TS.

- **not met**: Every choice the spec leaves open is written down in docs/decisions.md.

  Three dated lines cover: the hand-written stdlib generator, Pydantic strict mode with extra=forbid, the logger setting ts and service itself, using ajv for worker tests, and the limited runtime check in TS. Not recorded: making the optional `request_id` and `video_id` nullable in Python (the schema does not allow null), dropping None on output (`exclude_none`), and generating the TS union as a `LOG_EVENT_NAMES` const array.

## Proposed learnings (not decided)

- Code generators that clean their output directory must delete only the files they own: Python package dirs pick up __pycache__ as soon as tests import them.
- Test both modes of a generator script (generate and --check), not just the check; a green --check says nothing about whether regeneration works.
- When generating Pydantic models from JSON Schema, 'optional' (key may be absent) is not 'nullable'; emitting `X | None = None` widens the contract unless null is rejected explicitly.
- Pin the interpreter (`uv run --python 3.12`) for repo scripts run with --no-project.
