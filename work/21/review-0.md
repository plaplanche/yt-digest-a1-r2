# Review 0

- Reviewed commit: `64b9fd3a89757982f229344905332047614c2c19`
- Reviewer model: claude-opus-5-5
- Verdict: **no-go** (the reviewer answered no-go)

## Findings

- **blocking** (`worker/src/leases.ts:171`) The R2 'never overwritten' rule is a head-then-put split that two concurrent retries can interleave

  handleResult for `ok` runs these writes in order: (1) findLease (lease is active), (2) `TRANSCRIPTS.head(key)`, (3) `TRANSCRIPTS.put(key, …)`, (4) the endLease D1 batch. Take two concurrent copies of the same result, e.g. a node retrying after a network timeout (9 retries 5xx/network errors, and 8.9 says a retry has no side effect beyond the first). Request A does steps 1 and 2 (head returns null). Request B does steps 1 and 2 (head returns null). A puts. B puts and overwrites A's object with a new `produced_at`. Then one endLease wins and the other returns the stored response. This breaks 6.4 / C5 ('An existing object is never overwritten') and the retry rule of 8.9. The existence check has to be part of the write: use a conditional put (`onlyIf: { etagDoesNotMatch: '*' }`, where a null return means the object already exists). The test 'an existing R2 object is never overwritten' only covers the sequential case.

- **blocking** (`worker/src/leases.ts:227`) Revocation can miss a lease that a concurrent claim creates, which leaves an active lease on a revoked node

  revokeNode runs (1) `UPDATE nodes SET revoked_at` and then, as a separate statement, (2) `SELECT … FROM leases WHERE node_id = ? AND state = 'active'`, then (3) endLease for each row. A claim from the same node runs (a) the auth SELECT in handleNode (revoked_at is null) and then (b) the claim batch, which does not re-check the node. The interleaving a → 1 → 2 → b makes the claim insert a new `active` lease and a `leased` job after the revocation has listed the leases. That lease is never revoked: the job stays leased by a disabled node until LEASE_SECONDS runs out (600 s by default), and `leases_revoked` undercounts. 8.8 requires every active lease of the node to become revoked, and 8.9 requires the decision about who holds a job to be a single conditional statement or batch. Fix: guard the claim UPDATE with `AND EXISTS (SELECT 1 FROM nodes WHERE node_id = ?1 AND revoked_at IS NULL)`, or do the node update and the lease revocation in one batch that the claim's guard makes visible.

- **minor** (`worker/src/leases.ts:71`) The lease end does not check the expiry on the Worker's clock

  endLease's job UPDATE is guarded only by `status = 'leased' AND lease_id = ?`, not by `lease_expires_at > now`. The expiry is enforced only by the sweep at the start of the request, so a result whose sweep ran just before `lease_expires_at` and whose R2 write took longer is still accepted after the lease has expired. Adding `AND lease_expires_at > ?now` to the guard would close the gap.

- **minor** (`docs/decisions.md:53`) A stale result can still write to R2, and the decision records this against 8.4 step 2

  If the sweep or a revocation from another request ends the lease between findLease and endLease, the transcript has already been put to R2 and the answer is 409. That contradicts 'nothing is written (no R2 write)'. Some window is inherent, because C4 requires the R2 write before the lease completes. Still, the decision line presents a spec rule being broken as a free choice. It should at least say the window is narrow and that the next holder's result then keeps this object.

- **minor** (`e2e/tests/jobs.api.spec.ts:55`) E2E-13 must post its 6 results within the 2 s lease

  With LEASE_SECONDS=2, a slow CI runner that takes more than about 2 s between the claim and the last result would get 409 and fail the test now and then. Claiming and finishing in tight sequence keeps the window small, but nothing guards it.

- **blocking** Definition of done not met: The change does what the ticket and spec/lot-2.md (and spec/lot-1.md, which still applies) say, and nothing more.

  Routes, the order of the 8.4 steps, release, sweep, failure handling, revocation and the log events are implemented and match the spec in the sequential case. Two concurrency paths still break the spec. Concurrent identical results can overwrite the R2 object (6.4 C5, 8.9) because head and put are separate calls. A claim that interleaves with DELETE /ops/nodes leaves an active lease on a revoked node (8.8).

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

  Routes, the order of the 8.4 steps, release, sweep, failure handling, revocation and the log events are implemented and match the spec in the sequential case. Two concurrency paths still break the spec. Concurrent identical results can overwrite the R2 object (6.4 C5, 8.9) because head and put are separate calls. A claim that interleaves with DELETE /ops/nodes leaves an active lease on a revoked node (8.8).

- met: The change is covered by tests that fail without it.

  worker/tests/worker/results.test.ts uses fake Date timers. It covers ok with the R2 metadata and an idempotent retry, no_transcript, the three failure outcomes up to failed_video, expiry with a 409 for the late result, the exact-boundary expiry, every 422 rule, release and its idempotence, revocation and the logs. e2e/tests/jobs.api.spec.ts covers E2E-13/14/16/20/21. The routes did not exist before this change, so these tests would fail without it. The concurrent-retry and revoke-vs-claim races are not tested.

- met: Every choice the spec leaves open is written down in docs/decisions.md.

  Seven dated lines cover the hand-written validation and where the sweep runs, the lease-ending batch, the cleared lease fields, the validation reasons and word counting, the R2 serialization and head check, release and revocation events plus repeated revocation, and the test clock.

## Proposed learnings (not decided)

- 'Never overwritten' on R2 must be a conditional put (onlyIf etagDoesNotMatch '*'), not head-then-put: concurrent retries interleave between the two calls.
- When an ops action (revocation) must sweep a node's leases, the node-side write path (claim) must re-check the node's state in its own conditional statement, or a request authenticated just before the revocation creates a lease the revocation never sees.
- Lease-ending UPDATEs should also guard on lease_expires_at > now, so the expiry does not depend only on a sweep that ran earlier in the request.
