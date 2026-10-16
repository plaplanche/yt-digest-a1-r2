# Decisions

- 2026-10-16: Python is pinned to `>=3.12,<3.13` and the build backend is hatchling, the simplest layout for a `src/` package.
- 2026-10-16: `mypy --strict` runs on `node/src` and `node/tests` (the whole of `node/` minus the virtualenv), from `node/`.
- 2026-10-16: ESLint uses the flat config with `@eslint/js` and `typescript-eslint` recommended rules; `tsc` covers `worker/src` and `worker/tests`.
- 2026-10-16: the `contracts` check passes with a message while `scripts/contracts.sh` does not exist.
- 2026-10-16: the generator is the stdlib-only `scripts/contracts_gen.py` (run by `contracts.sh` with `uv run --no-project`) rather than a third-party tool; it handles only the JSON Schema subset the contracts use, and lint covers it with ruff and mypy.
- 2026-10-16: generated Pydantic models forbid extra fields and validate in strict mode; the logger converts the event to the generated `LogEventName` itself, and rejects `ts` and `service`, which it sets. Fields of the log line other than those are `request_id`, `video_id`, `attrs`, `level`.
- 2026-10-16: the log schema does not tie each event to its service or its `attrs` keys (the spec's tables are documentation); TypeScript has no generated runtime validator, so worker tests validate against the schema files with `ajv` (dev dependency), and `log.ts` checks event, field names and level at runtime.
- 2026-10-16: optional log fields (`request_id`, `video_id`) are typed non-null like the schema; the Python models default them to `None` only to mean "absent", and the logger writes with `exclude_unset` so the key is left out; the generator is run with `--python 3.12`.
- 2026-10-16: the catalogue is generated in TypeScript as a `LOG_EVENT_NAMES` const array with the `LogEventName` union derived from it, so `log.ts` can check names at runtime.
- 2026-10-16: VTT code lives in `yt_digest_node/vtt.py`; `clean_cues` takes segments as `(start, end)` float tuples and returns the paragraphs as a list of strings (joining with `\n\n` is left to the caller).
- 2026-10-16: for the 2.0 s gap, a "kept cue" is a cue outside the sponsor segments that still has at least one line after step 4; the gap is measured from the end of the previous such cue.
- 2026-10-16: tags are removed with the single pattern `<[^>]*>` (which covers every tag kind of step 3) before entities are decoded, so a decoded `&lt;` survives; bracketed annotations do not span lines.
- 2026-10-16: the 2.0 s gap is compared in whole milliseconds (VTT times are millisecond-exact), so float error never hides a gap; a cue whose lines are all rolling duplicates is not a kept cue, which is the reading of step 5 we keep.
