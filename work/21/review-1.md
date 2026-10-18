# Review 1

- Reviewed commit: `ac4b0af957825f4839476c9d002e446159d3ccfa`
- Reviewer model: claude-opus-5-5
- Verdict: **no-go** (the reviewer answered no-go)

## Findings

- **blocking** (`worker/src/leases.ts:172`) The R2 write happens before the conditional lease end that guards it, so a stale result can still write to R2

  Path of an `ok` result: (1) `sweepExpired` runs; (2) `findLease` reads the lease as `active` (line 151); (3) the R2 `put` writes `transcripts/<id>.json` with metadata node A / lease A (line 172); (4) `endLease` runs the conditional batch (line 186), which is the only check that decides whether the lease is still current. Interleaving: node A's result passes step 2 while `now < lease_expires_at`. Before step 3, the lease reaches `lease_expires_at` and a concurrent `/node/*` request or `GET /ops/jobs` runs the sweep and expires it (a `DELETE /ops/nodes/A` revoking it has the same effect). A's step 3 then writes the object, step 4 changes no row, and A gets 409 `stale_lease`. Spec 8.4 step 2 says a stale result writes nothing to R2 (C2). Because objects are never overwritten (C5), node B, the next holder, later gets 200 and `done` while its own transcript is silently dropped. R2 then keeps the transcript of a lease that was refused, and its metadata names that lease. docs/decisions.md (last line) admits this window, but writing it down does not make it correct. Possible fix: before the R2 put, run a conditional statement that moves the lease or job into a state the sweep and revocation skip, with a check that it is unexpired. After the put, complete it. If the put throws, return it to `active`/`leased` (C4). Only the request whose reservation changed a row may write to R2. Nothing tests this interleaving.

- **minor** (`worker/src/leases.ts:208`) The release batch does not check that the lease is unexpired on the Worker's clock

  `handleRelease` relies on the sweep that ran at the start of the request. Its UPDATE has no `lease_expires_at > now` condition, unlike the result path (`unexpired: true`). A lease that reaches `lease_expires_at` between the sweep and the release batch gets released: attempts − 1 and the node removed from `tried_nodes`. It should instead give 409 and go through the failure handling as `expired` (8.5, 8.6). The window is milliseconds with real lease durations, but the guard already used for results would close it.

- **minor** (`worker/src/leases.ts:229`) Revocation is split across statements, and a retry does not finish an interrupted one

  `revokeNode` first sets `revoked_at` in its own statement, then reads the active leases, then ends each one in a separate batch. If the Worker fails after the first statement, a repeated DELETE returns at line 231 (`revoked_at !== null`) and never revokes the remaining active leases. They stay until expiry and end as `lease_expired` instead of `lease_revoked` (8.8). Also, a `/node/result` that was authenticated before the revocation can still complete its lease after `revoked_at` is set, because `endLease` does not check `nodes.revoked_at`. Running the lease ending even when `revoked_at` is already set, or putting it in the same batch, would fix the retry case.

- **minor** (`worker/tests/worker/results.test.ts:76`) The 503 storage_error path (C4) is untested

  No test makes the R2 put throw and then checks for 503 `storage_error`, the lease still `active`, the job still `leased`, no node event, and a successful retry. Spec 8.4 step 4 requires this behaviour.

- **minor** (`e2e/tests/jobs.api.spec.ts:54`) E2E-13 and E2E-16 run against LEASE_SECONDS=2 with no margin

  The e2e stack runs with `LEASE_SECONDS=2`. E2E-13 must post its 6 results within 2 s of the claim, so a slow CI runner can expire leases and turn the 200s into 409s, which makes the test flaky. Making the lease duration configurable per test, or keeping these tests well inside the window, would make them sturdier.

- **minor** (`worker/src/leases.ts:172`) The R2 body is a re-serialization, not the JSON exactly as the node sent it

  6.4 asks for the body 'as the node sent it'. `JSON.stringify(body.transcript)` changes whitespace and number formatting. This choice is recorded in docs/decisions.md, so it is acceptable, but storing the raw request text would follow the spec more literally.

- **blocking** Definition of done not met: The change does what the ticket and spec/lot-2.md (and spec/lot-1.md, which still applies) say, and nothing more.

  Result, release, sweep, failure handling, revocation, GET /ops/transcripts and the log events are all implemented. However, an `ok` result whose lease expires or is revoked between the lease check and the conditional end still writes to R2 and gets 409, which breaks 8.4 step 2 (no R2 write for a stale result) and C2 (worker/src/leases.ts:172 before :186). A release does not check expiry at write time. Nothing outside the ticket's scope was added; the claim gained a `revoked_at` guard, which supports 8.8.

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

  Result, release, sweep, failure handling, revocation, GET /ops/transcripts and the log events are all implemented. However, an `ok` result whose lease expires or is revoked between the lease check and the conditional end still writes to R2 and gets 409, which breaks 8.4 step 2 (no R2 write for a stale result) and C2 (worker/src/leases.ts:172 before :186). A release does not check expiry at write time. Nothing outside the ticket's scope was added; the claim gained a `revoked_at` guard, which supports 8.8.

- met: The change is covered by tests that fail without it.

  worker/tests/worker/results.test.ts covers, with a controlled clock: ok and its retry, no_transcript, the three failures up to failed_video, expiry and a late result, expiry exactly at lease_expires_at, each 422 rule, release and its idempotence, revocation, and the logs. e2e/tests/jobs.api.spec.ts covers E2E-13, 14, 16, 20 and 21. Without the change these routes return 404. Gaps: 503 storage_error, and the race between the R2 write and expiry.

- met: Every choice the spec leaves open is written down in docs/decisions.md.

  Nine dated lines cover: hand-written validation, where the sweep runs, the batch design, clearing the lease fields, the reason codes and word counting, the R2 serialization and conditional put, no node event on release or revocation, the test clock, the claim/revocation guard, and the R2 window (a correctness issue, not an open choice; see findings).

## Proposed learnings (not decided)

- When an external write such as R2 must come before a D1 commit (C4), first reserve the right to write with a conditional D1 statement. Do the external write only if that reservation changed a row; otherwise a sweep or revocation can slip in between.
- Every lease-ending path (result, release) should repeat the 'unexpired at write time' guard in its own conditional statement, rather than rely on the sweep that ran at the start of the request.
- An idempotent operator action that short-circuits on 'already done' should still finish any follow-up writes left from an interrupted first attempt.
