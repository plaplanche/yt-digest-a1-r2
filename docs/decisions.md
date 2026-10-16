# Decisions

- 2026-10-16: Python is pinned to `>=3.12,<3.13` and the build backend is hatchling, the simplest layout for a `src/` package.
- 2026-10-16: `mypy --strict` runs on `node/src` and `node/tests` (the whole of `node/` minus the virtualenv), from `node/`.
- 2026-10-16: ESLint uses the flat config with `@eslint/js` and `typescript-eslint` recommended rules; `tsc` covers `worker/src` and `worker/tests`.
- 2026-10-16: the `contracts` check passes with a message while `scripts/contracts.sh` does not exist.
- 2026-10-16: the generator is the stdlib-only `scripts/contracts_gen.py` (run by `contracts.sh` with `uv run --no-project`) rather than a third-party tool; it handles only the JSON Schema subset the contracts use, and lint covers it with ruff and mypy.
- 2026-10-16: generated Pydantic models forbid extra fields and validate in strict mode; the logger converts the event to the generated `LogEventName` itself, and rejects `ts` and `service`, which it sets. Fields of the log line other than those are `request_id`, `video_id`, `attrs`, `level`.
- 2026-10-16: the log schema does not tie each event to its service or its `attrs` keys (the spec's tables are documentation); TypeScript has no generated runtime validator, so worker tests validate against the schema files with `ajv` (dev dependency), and `log.ts` checks event, field names and level at runtime.
