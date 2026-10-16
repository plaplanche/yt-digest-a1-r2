# Review 1

- Reviewed commit: `75b803be18482c85080232a7bd02d8804a245bc1`
- Reviewer model: claude-opus-5-5
- Verdict: **go**

## Findings

- **minor** (`worker/src/log.ts:22`) An explicit `attrs: undefined` produces a log line that breaks the schema

  `{ ..., attrs: {}, ...fields, level }` lets `fields.attrs = undefined` replace the default. JSON.stringify then drops `attrs`, which the schema requires. The same happens with `request_id: undefined` or `video_id: undefined`, though those two are optional. Unlike the Python logger, the runtime check does not validate the values of `attrs`, `video_id` (pattern) or `request_id`, so a caller who bypasses the types can write an invalid line. Spec 4.4 only requires a throw for an unknown event or field, so this is not blocking, but default `attrs` after the spread, for example `attrs: fields.attrs ?? {}`.

- **minor** (`node/src/yt_digest_node/contracts/log_event.py:24`) Optional fields are typed `str` but default to None

  `request_id: str = Field(default=None)  # type: ignore[assignment]` means reading `LogEvent(...).request_id` gives None while mypy sees `str`. This trade-off is documented in docs/decisions.md. Later code that reads these attributes should not trust the static type.

- **minor** (`node/src/yt_digest_node/contracts/transcript_result.py:9`) Strict mode is narrower than JSON Schema for integers

  With `strict=True`, `word_count` rejects a JSON `3.0`, which JSON Schema 2020-12 accepts as an integer. Ajv and Pydantic therefore disagree on that edge case. The decision 'validate in strict mode' is recorded but this consequence is not. It is harmless for this lot.

- **minor** (`worker/tests/log.test.ts:28`) No test shows the type system rejecting an uncatalogued event

  Spec 4.4 says the TypeScript rule is 'enforced by the type system and by a runtime check'. The tests cast with `as LogEventName` / `as never` and so cover only the runtime half. A `// @ts-expect-error` line run under `tsc --noEmit` would cover compile-time enforcement too.

## Definition of done

- met: check lint passes

  Replayed by Ariane: exit 0.

- met: check contracts passes

  Replayed by Ariane: exit 0.

- met: check test-node passes

  Replayed by Ariane: exit 0.

- met: check test-worker passes

  Replayed by Ariane: exit 0.

- met: The change does what the ticket and spec/lot-1.md say, and nothing more.

  Both schemas match the field tables and rules in spec sections 4.1 and 4.2, including additionalProperties false. contracts.sh generates TypeScript types and Pydantic v2 models, each starting with a do-not-edit header. The catalogue is a TS union (derived from LOG_EVENT_NAMES) and a Python StrEnum. --check regenerates into a temporary directory, names the stale files and exits 1, as section 4.3 requires. emit(event, level='info', **fields) raises ValueError (ValidationError is a subclass of it), and log.ts throws at runtime. The only additions are the ajv dev dependency, a lint extension covering the generator, and pydantic, all within scope. Nothing from the pipeline is included.

- met: The change is covered by tests that fail without it.

  node/tests/test_contracts.py and worker/tests/contracts.test.ts accept a valid result and log line, and reject an extra field, a bad video_id, a bad status and an unknown event. Further Python tests (subprocess runs on a repo copy) show --check failing and naming the file after a hand edit and after a schema change without regeneration. node/tests/test_log.py and worker/tests/log.test.ts show an uncatalogued event raising ValueError or throwing, with nothing written. Every test imports modules that this change creates, so all of them fail without it. The replayed checks lint, contracts, test-node and test-worker are green.

- met: Every choice the spec leaves open is written down in docs/decisions.md.

  Five dated lines cover the open choices: the stdlib generator run by `uv run --no-project`, strict models that forbid extra fields, the logger owning ts and service, the event/service/attrs tables treated as documentation only, ajv for TypeScript validation, optional fields meaning absent rather than null with exclude_unset, the --python 3.12 pin, and the LOG_EVENT_NAMES const array. Two consequences are not recorded, but both are minor: strict-int narrowing and generate mode deleting stray files in the output directories.

## Proposed learnings (not decided)

- When a schema is validated by two engines (Ajv for TypeScript, Pydantic strict mode for Python), check edge cases where they disagree, such as an integer written as 3.0 or an enum given as a string versus an instance.
- In TypeScript object spreads, put defaults after `...fields`, or use `??`, so that an explicit `undefined` cannot erase a required key.
- When a spec says a rule is 'enforced by the type system', ask for a `@ts-expect-error` test, not just casts to `never`.
