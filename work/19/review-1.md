# Review 1

- Reviewed commit: `33371584ae1a34c0e7d439ee8da9866775591c07`
- Reviewer model: claude-opus-5-5
- Verdict: **no-go** (the reviewer answered go)

## Findings

- **minor** (`worker/src/node.ts:99`) Retrying a claim hands out more jobs; this reading of 8.9 is not written down

  8.9 says retrying any `/node/*` request after a network failure has no side effect beyond the first. A retried `POST /node/claim` (for example after the response was lost) runs the batch again and leases up to `max_jobs` more jobs, each with `attempts` + 1 and the node added to `tried_nodes`. The claim schema has only `max_jobs`, so there is no idempotency key to deduplicate on, and the orphaned leases can only be recovered by the expiry sweep of the next ticket. This is how the spec is built rather than a bug in this change, but docs/decisions.md should say that a claim retry is a new claim.

- **minor** (`worker/src/node.ts:101`) An invalid LEASE_SECONDS silently falls back to 600

  `Number(env.LEASE_SECONDS) > 0 ? … : 600` accepts fractional values and quietly ignores garbage or non-positive values. This is a choice the spec leaves open, and it is not written down in docs/decisions.md.

- **minor** (`worker/src/index.ts:59`) Undocumented strictness of the /ops bodies

  `POST /ops/nodes` and `POST /ops/jobs` reject unknown keys with 400. Section 7 does not say that additional properties are refused, so this is an open choice, and it is missing from docs/decisions.md. Also, a priority that is an integer but larger than SQLite's 64-bit range (for example 1e20) passes validation and will probably fail at the D1 bind with a 500, not a 400.

- **minor** (`worker/src/node.ts:60`) Out of scope: /node/result and /node/release answer 404 for now

  The unknown-route check runs before authentication, so the two endpoints the next ticket adds give 404 even without a bearer. This is documented in decisions.md and acceptable until the next ticket. That ticket must make sure that once they exist, authentication runs before the 404 route check.

- **blocking** Definition of done not met: Every choice the spec leaves open is written down in docs/decisions.md.

  Seven decisions were added: hand-written validation, the claim batch and lease id format, enqueue semantics, rejection logging and route-before-auth, dedup, the deferred sweep, console.log. Not written down: what a retried claim does (8.9), the fallback for an invalid LEASE_SECONDS, and the rejection of unknown keys in the /ops bodies. All three are minor.

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

  POST /ops/nodes: the token is `ytd_node_` + base64url of 32 random bytes (43 chars), only its SHA-256 hex is stored, the node is `healthy`, an existing id gives 409. POST /ops/jobs: INSERT OR IGNORE then max() priority in one batch, answered in request order. GET /ops/jobs/<id> returns the section 7 fields and leaves out lease_id. /node/*: a missing, unknown or revoked token gives 401 and nothing is written; the operator token is refused because its hash is unknown. The body is validated after authentication. Heartbeat updates last_heartbeat_at and version and answers healthy, hourly_budget, run. The claim is one D1 batch: a conditional UPDATE … WHERE status='queued' AND rowid IN (eligible ORDER BY priority DESC, created_at, video_id LIMIT n) sets leased_by, lease_id, lease_expires_at, attempts+1 and tried_nodes. Then an INSERT…SELECT writes the active leases rows and a SELECT returns the jobs in the same order. All three statements run in one transaction, so concurrent claims cannot interleave. The log events match section 12 (console.log, per section 12). Expiry, results, releases and revocation are deferred and documented.

- met: The change is covered by tests that fail without it.

  worker/tests/worker/nodes.test.ts covers every Worker acceptance criterion: 401 ×3 on heartbeat and claim, heartbeat healthy/run/60, empty queue, default 3, priority then creation order, leased/attempts 1/tried_nodes plus the lease row and 600 s, tried_nodes exclusion, enqueue keeps existing jobs and raises priority only upwards. Concurrent claims of 4×3 over 12 jobs and of 3×3 over 7 jobs give [1,3,3] and 7 lease rows, on the Miniflare local D1. e2e/tests/claims.api.spec.ts: 2 nodes claim 6 jobs concurrently with no duplicate. None of the endpoints existed before this change, so every test fails without it. The checks are green.

- **not met**: Every choice the spec leaves open is written down in docs/decisions.md.

  Seven decisions were added: hand-written validation, the claim batch and lease id format, enqueue semantics, rejection logging and route-before-auth, dedup, the deferred sweep, console.log. Not written down: what a retried claim does (8.9), the fallback for an invalid LEASE_SECONDS, and the rejection of unknown keys in the /ops bodies. All three are minor.

## Proposed learnings (not decided)

- A D1 batch of a conditional UPDATE (subquery with LIMIT), an INSERT…SELECT tagged by a random claim prefix and a final SELECT is a working way to get atomic claims plus RETURNING-like output on D1.
- `/node/claim` has no idempotency key, so the 8.9 retry rule cannot hold for claims; record that it relies on lease expiry instead.
- e2e.sh starts the stack with LEASE_SECONDS=2; once the expiry sweep lands, the e2e claim tests must finish their assertions within 2 s.
