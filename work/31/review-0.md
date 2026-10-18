# Review 0

- Reviewed commit: `512884336dba1318472c34a3c0f280fca6d220e9`
- Reviewer model: claude-opus-5-5
- Verdict: **no-go** (the reviewer answered no-go)

## Findings

- **blocking** (`worker/src/token.ts:97`) Reuse detection can be bypassed: rotation and issuance are separate statements, and a concurrent reuse can run its revocation in between

  The refresh path (A) writes in this order: (1) `UPDATE oauth_tokens SET used_at … RETURNING` (token.ts:92-96), then awaits, then (2) `issueTokens` hashes the new tokens and runs `DB.batch` INSERTs of the new access and refresh token with the same family_id (token.ts:30-41). A concurrent request B with the same refresh token writes: (1') its conditional UPDATE matches nothing, (2') SELECT finds used_at set (token.ts:100), (3') `UPDATE … SET revoked_at WHERE family_id = ? AND revoked_at IS NULL` (token.ts:104), (4') logs reuse_detected. If the order is A1, B1', B2', B3', A2, A's new pair is inserted after the family was revoked, with revoked_at NULL, so it stays valid and can be refreshed again. This is exactly the attacker-and-victim race that reuse detection exists for: whoever wins the rotation keeps a working family even though spec 10.5 says the reuse 'revokes every token of its family'. Fix: make it one atomic decision. For example, put the mark-used UPDATE and both INSERTs in one D1 batch, with the INSERTs written as `INSERT … SELECT … WHERE EXISTS (the refresh row, now used by this request) AND NOT EXISTS (a revoked token in the family)`. Or make issuance conditional on the family not being revoked and check that both rows were written. Add a test that interleaves a reuse between rotation and issuance.

- **minor** (`worker/src/token.ts:97`) A failure between marking the refresh token used and inserting the new pair leaves the client unable to recover

  If the issuance batch fails after the conditional UPDATE succeeded, the response is a 500, the presented token is already marked used, and the client's retry is treated as reuse, which revokes the whole family. The single batch suggested above fixes this too. The same split exists for codes (token.ts:66 then 75), but there it only loses one code.

- **minor** (`worker/src/token.ts:117`) Content-Type check is a prefix match

  `startsWith("application/x-www-form-urlencoded")` also accepts a media type such as `application/x-www-form-urlencodedx`. Comparing the media type before any `;` would be exact.

- **minor** (`worker/src/token.ts:101`) Re-presenting an already revoked, used token logs reuse_detected with revoked 0

  After a family is revoked, every later reuse of a used token logs `auth.refresh.reuse_detected` again with `revoked: 0`. This is harmless but noisy. It is not covered by a test or written down in docs/decisions.md.

- **blocking** Definition of done not met: The change does what the ticket and spec/lot-2.md (and spec/lot-1.md, which still applies) say, and nothing more.

  The /token checks run in the order 10.5 gives (grant type, client, missing parameters, resource, code), codes are single-use through a conditional UPDATE … RETURNING, no-store is set and the 10.6 check is implemented. But reuse detection does not always revoke the family: a concurrent rotation can insert unrevoked tokens into the family after the revocation (token.ts:92-108 vs issueTokens). No /mcp or out-of-scope work was added.

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

  The /token checks run in the order 10.5 gives (grant type, client, missing parameters, resource, code), codes are single-use through a conditional UPDATE … RETURNING, no-store is set and the 10.6 check is implemented. But reuse detection does not always revoke the family: a concurrent rotation can insert unrevoked tokens into the family after the revocation (token.ts:92-108 vs issueTokens). No /mcp or out-of-scope work was added.

- met: The change is covered by tests that fail without it.

  worker/tests/worker/token.test.ts covers each 10.5 error, a failed exchange using up the code, no-store, rotation keeping earlier access tokens valid, reuse revoking the family (revoked: 4) with its log, and the 10.6 accept and refuse cases (expired, revoked, refresh, node, revoked invite). e2e/tests/token.api.spec.ts covers E2E-31 over HTTP with login_hint. Both files are new and test endpoints that did not exist before. The concurrent-reuse case is not tested.

- met: Every choice the spec leaves open is written down in docs/decisions.md.

  Three dated lines were added: the Content-Type rule, a missing grant_type, no-store on errors and the fixed scope; the conditional rotation, reuse scoped to the token's own client with the revoked count, and fresh lifetimes; and the verifyAccessToken shape, admission read in the same query, and logging left to the caller. The minor log-noise behaviour is not written down, but it is not a spec choice.

## Proposed learnings (not decided)

- For refresh rotation with reuse detection, check whether the rotation (mark used) and the issuance (insert the new pair) can be separated by a concurrent revocation of the family. Issuance has to be conditional on the family not being revoked, or happen in the same batch.
- With D1, every `await` between two statements is a point where another request can interleave. A 'check then write' across awaits needs a single conditional statement or a batch.
