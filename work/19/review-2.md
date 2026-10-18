# Review 2

- Reviewed commit: `8e70711106900c75494f6d87578a981c53a51a14`
- Reviewer model: claude-opus-5-5
- Verdict: **no-go** (the reviewer answered no-go)

## Findings

- **blocking** (`worker/src/node.ts:107`) A retried POST /node/claim writes a second time, which breaks 8.9 (principle 3)

  Spec 8.9 says: "Retrying any `/node/*` request after a network failure has no side effect beyond the first". The ticket puts section 8.9 in scope. In `claim()` each request runs the batch below and nothing ties a retry to the first request. Order of writes on one path: (1) UPDATE jobs → leased, attempts+1, node appended to tried_nodes, lease_id/lease_expires_at set; (2) INSERT INTO leases … 'active'; (3) SELECT; (4) job.claimed logs; (5) response. Interleaving that breaks it: claim A commits steps 1–2, then its response is lost. The node retries, and claim B runs steps 1–2 again on the next eligible jobs. A's jobs stay `leased` to a node that never learned their lease ids, each has spent one of its 3 attempts, and the node is now permanently ineligible for them (tried_nodes). B's retry has also leased extra jobs. docs/decisions.md writes this down ("a retried POST /node/claim is a new claim"), but that sentence contradicts the spec; it does not fill a gap the spec leaves open. One fix is to make a claim return the node's still-active, unreported leases before it takes new ones, inside the same batch. Another is any other design where a retry has no further side effect.

- **minor** (`worker/tests/worker/nodes.test.ts:146`) The order test cannot tell creation order from video_id order

  vid(1) is created before vid(2)/vid(3) and also sorts first by video_id. The test would still pass if `created_at ASC` were dropped from the ORDER BY. A job created earlier with a larger video_id would actually pin creation order ahead of video_id.

- **minor** (`worker/tests/worker/nodes.test.ts:6`) The LEASE_SECONDS default and fallback are untested

  The tests always bind LEASE_SECONDS "600", so the fallback to 600 when the variable is missing or invalid, recorded in docs/decisions.md, is never exercised. A test with another value (e.g. "30") would show the variable is actually read.

- **minor** (`worker/src/node.ts:79`) Expiry sweep not run on /node/* or GET /ops/jobs (out of scope)

  Spec 8.1/8.6 require the sweep after authentication and validation. The ticket assigns expiry to the next ticket, and docs/decisions.md records that it is deferred. This note is only so it isn't forgotten.

- **minor** (`worker/src/node.ts:120`) Claim rows are found by an unindexed LIKE over jobs

  Both the INSERT … SELECT and the final SELECT filter on `lease_id LIKE ?1 || '.%'`, which scans the whole jobs table twice per claim. It is correct, but `UPDATE … RETURNING`, or an exact lease_id prefix range on an indexed column, would scale better.

- **blocking** Definition of done not met: The change does what the ticket and spec/lot-2.md (and spec/lot-1.md, which still applies) say, and nothing more.

  Most of it matches the spec: /ops/nodes, /ops/jobs and GET /ops/jobs; tokens and their SHA-256 hashes; node auth; heartbeat; claim in one batch with eligibility, order, lease fields and a leases row; the log events. But section 8.9's rule that a retried /node/* request has no extra side effect is not met for claim (worker/src/node.ts:107). docs/decisions.md even records the deviation.

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

- **not met**: The change does what the ticket and spec/lot-2.md (and spec/lot-1.md, which still applies) say, and nothing more.

  Most of it matches the spec: /ops/nodes, /ops/jobs and GET /ops/jobs; tokens and their SHA-256 hashes; node auth; heartbeat; claim in one batch with eligibility, order, lease fields and a leases row; the log events. But section 8.9's rule that a retried /node/* request has no extra side effect is not met for claim (worker/src/node.ts:107). docs/decisions.md even records the deviation.

- met: The change is covered by tests that fail without it.

  worker/tests/worker/nodes.test.ts covers every acceptance criterion: the 401 cases, the heartbeat, the empty queue, the default of 3, order, lease, attempts and tried_nodes, the tried-node exclusion, the priority raise, and concurrent claims on local D1 including the 1/3/3 case. e2e/tests/claims.api.spec.ts covers 2 nodes and 6 jobs. Without the change the routes did not exist (404), so these tests would fail. Gaps: the created_at ordering and the LEASE_SECONDS value.

- met: Every choice the spec leaves open is written down in docs/decisions.md.

  Ten dated lines cover: the hand-written validation, the batch design and lease id format, INSERT OR IGNORE plus max() with the job.enqueued granularity, the ops reject log and the 404-before-auth order, dedup within a request, the deferred sweep, console.log, the LEASE_SECONDS fallback, and strict ops bodies. The claim-retry line, however, records a contradiction of the spec, not an open choice.

## Proposed learnings (not decided)

- When docs/decisions.md says the spec's requirement is not met (e.g. 'a retried claim is a new claim'), it is a deviation, not a decision. Check each decision line against the spec text.
- For claim endpoints, check retry idempotence separately from concurrency atomicity. A single D1 batch gives the second but not the first.
- Ordering tests need data where each sort key changes the result on its own; otherwise a dropped ORDER BY term goes unnoticed.
