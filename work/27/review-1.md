# Review 1

- Reviewed commit: `fb3ec70c97a6a4985fd7d3d13d9aab39706144c3`
- Reviewer model: claude-opus-5-5
- Verdict: **go**

## Findings

- **minor** (`worker/src/oauth.ts:256`) An ID token whose aud is an array is accepted, and this is not recorded

  Spec 10.4 step 3 requires `aud` = GOOGLE_CLIENT_ID. The code also accepts an array that contains the client id, and it does not check `azp`, which OIDC Core requires when there are several audiences. This leniency is a choice the spec does not make, and docs/decisions.md does not record it. Either require `aud === clientId` or write the choice down.

- **minor** (`worker/src/oauth.ts:203`) Deny still works after an approve; approve twice does not

  The deny UPDATE checks only `used_at IS NULL`, not `google_state IS NULL`. So a request that was already approved (its Google state is bound) can still be denied. The deny uses it up, and the later Google callback gets a 400. Approving twice gives 400, so the two decisions behave differently. Nothing unsafe follows (no code is issued), but the asymmetry is not in docs/decisions.md.

- **minor** (`worker/src/oauth.ts:217`) Bad Google metadata after the bind leaves the request stuck; an uncaught throw gives the runtime's own 500

  The order on approve is: fetch the discovery document, bind state and nonce with a conditional UPDATE, then build the redirect with `new URL(metadata.authorization_endpoint)`. If the document has no valid `authorization_endpoint`, that last step throws after the bind, so the approve can no longer be retried. That contradicts the 'retryable' decision. Separately, a failed fetch is a throw that index.ts never catches (`fetch` has no try/catch), so the answer is the runtime's own error page, not a page the Worker controls. Also, an unknown `request` id still triggers the outbound Google fetch before the 400.

- **minor** (`worker/src/oauth.ts:277`) The callback runs its UPDATE before checking that a state is present

  With no `state` parameter, the UPDATE still runs with `google_state = ''`. It matches nothing, so nothing goes wrong. Checking `q.get("state") === null` before the UPDATE would make the guard come first.

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

  oauth.ts covers 10.1 discovery (both protected-resource paths and the authorization-server document), 10.2 registration with its error codes, and 10.3 authorize with the checks in order (400 HTML with no redirect for an unknown client or redirect_uri; then unsupported_response_type, invalid_request, invalid_target, invalid_scope). The consent page escapes its text and has two decision buttons. The consent POST handles deny (access_denied) and approve (every Google parameter, state/nonce bound with a conditional UPDATE). For 10.4: the pending authorization is used up by a conditional UPDATE … RETURNING; RS256, iss, aud, exp and nonce are checked; email_verified is checked before any write; the users upsert, invite update and code insert run in one D1 batch, each guarded by the same admission predicate, so a concurrent revoke cannot interleave. The refresh token is AES-GCM `v1:` (6.3). The three log events carry only client_id/role/reason. The token endpoint, /mcp, PATs and sessions are not added. Small leniencies (aud as an array) are minor findings.

- met: The change is covered by tests that fail without it.

  worker/tests/worker/oauth.test.ts (all new routes, so it fails without the change) covers: discovery; every 10.2 error; the 10.3 error order and the no-redirect cases; consent escaping and its two buttons; deny gives access_denied; approve parameters and single use; bad/reused/expired state; bad signature, aud, iss, nonce, exp; a failing token endpoint; invited user → member row and code; admin → admin row; non-invited, revoked and unverified → 403 with no row or code; a revoke during the callback; the refresh token encrypted and in no table in clear; logs free of secrets. The e2e tests add E2E-29 (api), the full browser login and E2E-02 (browser). All five checks were replayed green.

- met: Every choice the spec leaves open is written down in docs/decisions.md.

  Eight dated lines were added: config fallbacks, register parsing and limits, scope parsing, approve binding and single use, denied reasons, unverified admin and refresh-token keeping, no discovery cache, and access control as part of the writes. Remaining gaps (aud as an array, deny after approve) are small and reported as minor findings.

## Proposed learnings (not decided)

- For an OAuth callback, check that the admission predicate is inside each guarded INSERT of one D1 batch; a separate SELECT-then-write leaves room for a concurrent invite revoke.
- When a handler fetches external metadata before a conditional bind, check that nothing after the bind can throw. Otherwise the 'retryable' promise breaks.
- Compare how each consent decision is guarded (deny vs approve WHERE clauses); asymmetric guards are easy to miss.
