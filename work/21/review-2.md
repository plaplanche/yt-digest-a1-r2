# Review 2

- Reviewed commit: `1cb554e929ea32dbcc5c9c4ae89e08ce2c330ecb`
- Reviewer model: claude-opus-5-5
- Verdict: **no-go** (the reviewer answered no-go)

## Findings

- **blocking** (`worker/src/leases.ts:239`) Release requeues a job whose lease is `storing`: the job write comes before the lease-state check

  handleRelease's batch runs its first statement, `UPDATE jobs … WHERE status = 'leased' AND lease_id = ?3 AND lease_expires_at > ?4`, without checking that the lease is still `active`. Only the second statement checks that (`UPDATE leases … WHERE state = 'active' AND changes() > 0`). A clean stop that releases a lease while the same node posts its result can interleave like this: (1) release findLease sees `active`; (2) the result's reservation (line 191) moves the lease to `storing`; (3) the release batch's job UPDATE matches, so the job goes back to `queued` with attempts − 1 and the node removed from tried_nodes, and then the lease UPDATE changes 0 rows; (4) the release does the sweep and findLease, sees `storing` and answers 409; (5) the result's R2 put writes `transcripts/<id>.json`; (6) the result's endLease job UPDATE fails because lease_id is now NULL, so it answers 409 stale_lease. In the end both requests got 409, an R2 object exists for a lease that was never completed, the lease is stuck in `storing` forever (the sweep only finds leases through `jobs.lease_id`), no node event is recorded, and the job is re-handed out with the stale object kept. This breaks C2 (a result is accepted only for the current lease) and 8.4 (a 409 writes nothing). Fix: make the job UPDATE also require the lease state, for example `AND EXISTS (SELECT 1 FROM leases WHERE lease_id = ? AND state = 'active')`.

- **blocking** (`worker/src/leases.ts:78`) endLease updates the job before, and independently of, the lease-state guard

  In the endLease batch, statement 1 (the jobs UPDATE) is conditioned only on `jobs.status = 'leased' AND jobs.lease_id = ?`. The `from` state (`active`/`storing`) is checked only in statement 2, which is guarded by changes() of statement 1, not the other way round. A validation failure or a non-ok result (`from: 'active'`, line 176/221) that races an `ok` reservation of the same lease can interleave like this: findLease sees `active` → the ok request reserves (`storing`) → the 422 or error path's batch requeues or fails the job, then its lease UPDATE changes 0 rows and it answers 409 → the ok request writes R2 and then gets 409 from endLease. The result is the same corruption as the release case: the job is failed or requeued, an R2 object is written under 409 answers, and an orphaned `storing` lease remains. Adding the `storing` state broke the invariant 'job leased with lease_id X ⇔ lease X active' that the batch relied on. No test covers a result or release racing a reservation.

- **minor** (`worker/src/leases.ts:168`) `storing` is a lease state the spec does not have; a retry during an in-flight ok result gets 409 stale_lease

  Spec 6.3 lists the lease states as active, completed, released, expired, revoked, rejected. The change adds `storing`, which docs/decisions.md documents as a choice. In practice this has three effects. (a) A retry of an ok result sent while the first request is still writing to R2 (for example after a client timeout) sees `storing` and gets 409 stale_lease plus a job.stale_result log, even though the job will end `done`; spec 8.4 step 2 only gives 409 for released/expired/revoked/rejected, and the node daemon will treat the result as stale. (b) 8.6 says every leased job whose lease_expires_at ≤ now is expired, but a `storing` lease is kept for up to 60 s past expiry, so GET /ops/jobs can show `leased` after expiry. (c) 8.8 says every active lease of a revoked node is revoked, but a `storing` lease is skipped. Consider a retry-safe answer for `storing` (for example 503, retry later) or a design that keeps the spec's states.

- **minor** (`worker/src/leases.ts:115`) Sweep reads the lease state in a separate statement; an R2 put slower than the 60 s grace can write after the lease was expired

  sweepExpired selects candidates, then calls leaseState() for each in a separate read, then endLease. If an ok request's R2 put takes longer than STORING_GRACE_MS past expiry, the sweep expires the lease and requeues the job, then the put lands and the request answers 409 even though it wrote an object. This is an edge case, but it is the same 'write after the guarding check' pattern.

- **minor** (`worker/src/leases.ts:205`) R2 body is a re-serialisation, not the JSON 'as the node sent it'

  Spec 6.4 says the body is the transcript result JSON as the node sent it. The code stores JSON.stringify of the parsed object, which normalises whitespace and number formatting. This is documented in docs/decisions.md and is acceptable, but it is a reading of the spec, not something the spec leaves open.

- **minor** (`worker/src/leases.ts:221`) Non-ok results from a node revoked mid-request are still accepted

  The ok path checks `nodes.revoked_at IS NULL` in its reservation, but the unavailable/blocked/error path does not. A result whose authentication passed just before a DELETE /ops/nodes can still win the endLease race against the revocation. The outcome is consistent (only one request wins), but the two paths do not apply the revocation check the same way.

- **blocking** Definition of done not met: The change does what the ticket and spec/lot-2.md (and spec/lot-1.md, which still applies) say, and nothing more.

  The endpoints, sweep, failure handling, revocation, logs and E2E scenarios are implemented. However, the `storing` reservation adds a lease state that is not in 6.3, delays expiry past lease_expires_at, and skips revocation of such leases. Through the unguarded job UPDATEs in endLease and handleRelease (leases.ts:78, :239), a result racing a release or validation failure can write R2 while answering 409 and leave an orphaned lease. This breaks 8.4 step 2 and C2 of 8.9.

- **blocking** Definition of done not met: The change is covered by tests that fail without it.

  worker/tests/worker/results.test.ts and e2e/tests/jobs.api.spec.ts cover every acceptance criterion and fail without the change, since the endpoints did not exist. No test covers a release or a non-ok/invalid result racing an ok reservation, which is where the blocking defect lives.

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

  The endpoints, sweep, failure handling, revocation, logs and E2E scenarios are implemented. However, the `storing` reservation adds a lease state that is not in 6.3, delays expiry past lease_expires_at, and skips revocation of such leases. Through the unguarded job UPDATEs in endLease and handleRelease (leases.ts:78, :239), a result racing a release or validation failure can write R2 while answering 409 and leave an orphaned lease. This breaks 8.4 step 2 and C2 of 8.9.

- **not met**: The change is covered by tests that fail without it.

  worker/tests/worker/results.test.ts and e2e/tests/jobs.api.spec.ts cover every acceptance criterion and fail without the change, since the endpoints did not exist. No test covers a release or a non-ok/invalid result racing an ok reservation, which is where the blocking defect lives.

- met: Every choice the spec leaves open is written down in docs/decisions.md.

  docs/decisions.md has ten new dated lines. They cover the validation reasons, word counting, the conditional R2 put, the storing reservation and its 60 s grace, release/revocation events, LEASE_SECONDS=5 in e2e, and fake timers.

## Proposed learnings (not decided)

- In a D1 batch guarded by `changes() > 0`, the first statement must carry every condition (including the lease state); later statements cannot undo it.
- Adding an intermediate state (such as `storing`) to a state machine invalidates every conditional UPDATE that assumed the old invariant; re-audit each writer.
- Test result/release/revocation races with a wrapped D1 binding that injects the competing write between the read check and the batch.
