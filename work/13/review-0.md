# Review 0

- Reviewed commit: `5e85674f03db09625987fec6b75898df484a74b1`
- Reviewer model: claude-opus-5-5
- Verdict: **go**

## Findings

- **minor** (`worker/tests/contracts.test.ts:146`) The TypeScript reuse test only checks source text

  The test that shows the result-request type reuses TranscriptResult checks the generated file's text: the import line is there, `interface TranscriptResult` is not, and `word_count` is not. It meets the acceptance criterion. A type-level assertion (for example `expectTypeOf<NodeResultRequest["transcript"]>().toEqualTypeOf<TranscriptResult | null>()`) would also catch a change to the annotation. The Python test is stronger because it compares the model field annotation with `TranscriptResult | None`.

- **minor** (`node/src/yt_digest_node/contracts/node_claim_request.py:9`) The Python model leaves an absent `max_jobs` as None, not the spec's 3

  `max_jobs: int = Field(default=None, ...)  # type: ignore[assignment]` follows lot 1's pattern for optional fields: absent is accepted, an explicit null is rejected in strict mode. Spec 4.1 says "absent means 3". The schema does not encode that default, so the code that reads the model must apply it. That code is the Worker route, which is out of scope here, so this is only a note for the next ticket.

- **minor** (`worker/tests/contracts.test.ts:73`) The TypeScript negative cases cover less than the Python ones

  Python also rejects a 65-character `version`, a `disk_free_ratio` of 1.5 and a transcript with an inconsistent `status`. The ajv tests do not. All of the ticket's required cases are covered in both languages, so this does not block.

## Definition of done

- met: check lint passes

  Replayed by Ariane: exit 0.

- met: check contracts passes

  Replayed by Ariane: exit 0.

- met: check test-node passes

  Replayed by Ariane: exit 0.

- met: check test-worker passes

  Replayed by Ariane: exit 0.

- met: check e2e passes

  Replayed by Ariane: exit 0.

- met: The change does what the ticket and spec/lot-2.md (and spec/lot-1.md, which still applies) say, and nothing more.

  I checked the schemas field by field against spec 4.1 and 4.2. Version is 1 to 64 characters, uptime_s and jobs_in_progress are integers ≥ 0, the two timestamps are timestamp-or-null and optional, disk_free_ratio is in [0, 1], and cpu_temp_c is optional. max_jobs is 1 to 10. lease_id has minLength 16 in the claim response and minLength 1 in the result and release requests. The outcome and status enums match. `transcript` is a required key, written as anyOf a $ref and null. The error body has two objects, both with additionalProperties false. All 19 events of section 12 are added to the log-event enum, and the generated TS and Python enums both list them. The generator resolves the $ref to an import in both languages (`from yt_digest_node.contracts.transcript_result import TranscriptResult` and `import type { TranscriptResult } from "./transcript-result"`). No routes, stack or daemon work is included. There are no side effects to order: the change is schemas, generated code and tests only.

- met: The change is covered by tests that fail without it.

  node/tests/test_contracts.py imports the new generated modules and has parametrised valid and invalid cases: an extra field, max_jobs 0 and 11, unknown outcome, a transcript that breaks the transcript-result schema, a heartbeat without version, and a missing transcript key. It also asserts the reuse through the field annotation. worker/tests/contracts.test.ts compiles each new schema with ajv, with transcript-result registered so the $ref resolves, and runs the same required cases. Both loggers have a new test that accepts a lot 2 event (`worker.call` in Python, `job.claimed` in TS). The existing tests that reject events outside the catalogue are still there (test_log.py:30, log.test.ts). The existing stale-file test still covers `--check` failing, because the generator globs every schema. All of these tests would fail without the new schemas, the generated files or the extended enum.

- met: Every choice the spec leaves open is written down in docs/decisions.md.

  docs/decisions.md has three new dated lines (2026-10-18). They cover the anyOf $ref/null form and how the generator resolves it, nested titled objects (ClaimedJob, ErrorBody) generated in the parent file, minLength and maxLength support in the generator, reuse of the ts pattern for every timestamp, and the absent-or-valid policy for optional fields, with null only where the spec allows it.

## Proposed learnings (not decided)

- When a schema uses a relative `$ref` and has no `$id`, ajv tests must `addSchema` the referenced file under the same key, or compile fails.
- Prefer a type-level assertion (expectTypeOf) to a source-text check when you need to prove that a generated TS type reuses another one.
- The spec's "absent means 3" for max_jobs is not in the generated models. The Worker claim route ticket must apply it.
