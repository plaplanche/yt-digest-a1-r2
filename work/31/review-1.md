# Review 1

- Reviewed commit: `70a8ce063c75dedbfd549b9a28f68a64abdf9c91`
- Reviewer model: claude-opus-5-5
- Verdict: **go**

## Findings

- **minor** (`worker/src/token.ts:117`) A repeated reuse of a used refresh token logs nothing

  Section 10.5 says the reuse of an already used refresh token "logs auth.refresh.reuse_detected". The code logs it only when the revoke UPDATE changed at least one row. So once the family is revoked, presenting the same used token again gives invalid_grant with no log line, and the test at token.test.ts:239 pins that behaviour. The choice is written down in docs/decisions.md and does not affect security (the family is already revoked). Still, it drops a security signal the spec asks for on every reuse.

- **minor** (`docs/decisions.md:74`) The decision wording on expired tokens does not match the code for a used and expired token

  The decision says "an unknown, expired, revoked or other-client token is invalid_grant and revokes nothing". In token.ts:110-117, a refresh token that is both used and expired still revokes its family, because only `used_at` is checked. That is a defensible reading of the spec (used comes first). The decision line should say that used takes precedence over expired, so the record matches the behaviour.

- **minor** (`worker/src/token.ts:103`) The refresh success response duplicates issueTokens

  The 200 body and headers of a refresh (lines 104-108) repeat issueTokens (lines 41-45), including the auth.token.issued log. A later change to the token response would have to be made in two places. This is a maintainability issue, not a defect.

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

  POST /token (index.ts:185, token.ts:124) checks, in order: form-encoded body, grant type (unsupported_grant_type), client (401 invalid_client), missing parameters (invalid_request), resource (invalid_target), then the code. The code check is a single `UPDATE … WHERE used_at IS NULL RETURNING`, so the first exchange that reaches it uses the code up, successful or not, and concurrent exchanges cannot both win. PKCE S256 is compared to b64url(sha256(verifier)). Every response carries no-store. Refresh rotation is one D1 batch: two INSERT…SELECTs guarded by the presented row being usable and its family holding no revoked token, then the mark-used UPDATE, so all three writes happen or none do. A concurrent duplicate refresh finds the token used and revokes the family, which is the reuse rule. A child rotation that interleaves with the reuse SELECT/UPDATE is either revoked by the family-wide UPDATE or blocked by the NOT EXISTS guard. verifyAccessToken (10.6) reads the token, user and admission (ADMIN_EMAIL or an unrevoked invite) in one query on every call. Both log events follow section 12 and contain no secrets. /mcp is not touched.

- met: The change is covered by tests that fail without it.

  worker/tests/worker/token.test.ts covers every 10.5 error the ticket lists: unknown client, wrong verifier, used, expired, other-client and other-redirect_uri codes, missing parameter, wrong resource, unknown grant, a non-form body. It also covers a code used up by a failed exchange, no-store, rotation that keeps earlier access tokens valid, and reuse that revokes the family (revoked: 4, access tokens included, another family untouched). For 10.6 it tests valid, expired, revoked, refresh, node, ops and wrong-resource tokens, plus a revoked invite. e2e/tests/token.api.spec.ts runs E2E-31 over HTTP (consent form, fake Google login_hint, callback) and shows the family's revocation at /token. Without the change, /token and token.ts do not exist, so these tests fail. All replayed checks are green.

- met: Every choice the spec leaves open is written down in docs/decisions.md.

  docs/decisions.md has four dated lines covering: Content-Type handling, a missing grant_type, no-store on errors, scope, the rotation batch, the reuse revocation and when it is logged, behaviour on other-client, expired and revoked tokens, fresh lifetimes, and the verifyAccessToken API and its logging. One line is slightly imprecise about used-and-expired tokens (minor finding).

## Proposed learnings (not decided)

- For refresh rotation on D1, a batch of INSERT…SELECT statements guarded by the presented row, followed by the mark-used UPDATE, gives all-or-nothing rotation. The family-revoked NOT EXISTS guard closes the race against a concurrent reuse revocation.
- When reviewing reuse detection, check whether the reuse log fires on every reuse or only on the first revocation; the spec wording usually asks for every reuse.
