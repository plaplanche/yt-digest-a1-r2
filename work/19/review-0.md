# Review 0

- Reviewed commit: `a251232b9843e1f2056c9e2009f38d8dc56393d6`
- Reviewer model: claude-opus-5-5
- Verdict: **no-go** (the reviewer answered go)

## Findings

- **minor** (`docs/decisions.md:42`) Decision says unknown /node/* routes are checked after authentication, the code checks them before

  The decision line says 'a malformed /node/* or unknown /node/* route is checked after authentication'. But worker/src/node.ts:60-63 returns 404 `not_found` for a non-POST method or an endpoint other than heartbeat/claim before it reads the bearer. So `/node/result` without a token gives 404, not 401. Either order fits 6.1 and 8.1, but the written decision has to match the code. Fix one or the other.

- **minor** (`worker/src/index.ts:95`) A video id repeated in one POST /ops/jobs lands in both `enqueued` and `existing`

  With `video_ids: [a, a]`, the first INSERT OR IGNORE changes 1 row and the second changes 0, so the answer is `{enqueued: [a], existing: [a]}`. The spec does not cover duplicates in a request. That makes it an open choice, and it is not written down in docs/decisions.md. Either reject duplicates (400) or dedupe them, and record the choice.

- **minor** (`worker/src/node.ts:72`) Out of scope: the expiry sweep after authentication and validation is not run yet

  8.1 and 8.6 ask for the sweep on every /node/* request and on GET /ops/jobs/<video_id>. The ticket puts expiry in the next ticket, and docs/decisions.md records the deferral. This is noted only so the next ticket adds it between validation and the claim batch.

- **minor** (`worker/src/node.ts:18`) Hand-written validators copy the JSON schemas and can drift from them

  validHeartbeat and validClaim match contracts/node-heartbeat-request.schema.json and node-claim-request.schema.json today. But no test checks the Worker's validator against the schema, for example by running the same fixtures through both Ajv and the Worker. If a schema changes, the Worker can drift silently. Ajv standalone (precompiled) code would avoid both the runtime code generation and the duplication.

- **blocking** Definition of done not met: Every choice the spec leaves open is written down in docs/decisions.md.

  Recorded: hand-written validation, the batch design and lease_id format, enqueue semantics and the job.enqueued granularity, ops bearer logging, the deferred sweep, and console logging. Missing: how a video id repeated in one POST /ops/jobs is handled. Also, the line on /node route vs auth order does not match the code (404 comes before authentication).

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

  POST /ops/nodes: token `ytd_node_` + base64url of 32 bytes, SHA-256 hex stored, 409 on an existing node. POST /ops/jobs: INSERT OR IGNORE plus `max()` priority in one batch, answered in request order. GET /ops/jobs/<id> has the fields of section 7. /node auth gives 401 for missing, unknown or revoked tokens, and the operator token is refused. Heartbeat records last_heartbeat_at and version and answers healthy/run/hourly_budget. Claim is one D1 batch (conditional UPDATE with an ordered LIMIT subquery, then INSERT…SELECT of the leases rows, then SELECT). It sets leased, leased_by, lease_id (unique, ≥16 characters), lease_expires_at = now + LEASE_SECONDS, attempts+1 and tried_nodes appended. Log events follow section 12, written with console.log. Order of writes: enroll is one INSERT then the log; enqueue is one batch then the log; claim is auth, then body, then one atomic batch, then the logs; heartbeat is one UPDATE then the log. No write comes before its guard, and no decision is split across statements. Results, releases, expiry and revocation are not built (out of scope). Only a doc/code mismatch on 404 vs 401 order and an undocumented duplicate-id behaviour remain, both minor.

- met: The change is covered by tests that fail without it.

  worker/tests/worker/nodes.test.ts is new. It covers: 401 for missing, unknown and operator tokens on both endpoints; heartbeat answering healthy/run/60 and the row update; an empty queue; a default of 3; priority then creation order; leased with attempts 1, tried_nodes, a lease row and 600 s; tried_nodes exclusion; priority raised only upwards; concurrent claims by 4 nodes over 12 jobs, and by 3 nodes over 7 jobs giving [1,3,3] with 7 lease rows, on the local D1. e2e/tests/claims.api.spec.ts has 2 nodes claim 6 jobs concurrently. All of these endpoints are new, so the tests fail without the change. All checks are green.

- **not met**: Every choice the spec leaves open is written down in docs/decisions.md.

  Recorded: hand-written validation, the batch design and lease_id format, enqueue semantics and the job.enqueued granularity, ops bearer logging, the deferred sweep, and console logging. Missing: how a video id repeated in one POST /ops/jobs is handled. Also, the line on /node route vs auth order does not match the code (404 comes before authentication).

## Proposed learnings (not decided)

- Check that every docs/decisions.md line matches the code. A decision about check order is easy to write the wrong way round.
- For enqueue-style endpoints that take a list, check how duplicates within one request are handled. A per-item INSERT OR IGNORE puts the same id in both 'new' and 'existing'.
- A claim done as a D1 batch (conditional UPDATE with an ordered LIMIT subquery, then INSERT…SELECT keyed by a per-claim random prefix) gives atomic claims that never come back short, without needing RETURNING.
