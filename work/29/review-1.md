# Review 1

- Reviewed commit: `8e3d301c8b4122030116077581a05dfbcca03a35`
- Reviewer model: claude-opus-5-5
- Verdict: **go**

## Findings

- **minor** (`worker/src/oauth.ts:393`) auth.oauth.denied logs a reason outside the catalogue of section 12

  If encryption fails, the callback logs `auth.oauth.denied` with reason `server_error`. Section 12 gives a closed list of reasons: `access_denied`, `not_invited`, `email_unverified`, `google_error`. The spec does not cover the encryption-failure case, and the choice is written in docs/decisions.md. Still, the closed list is not respected. A listed reason such as `google_error`, or no denial line at all, would keep the log within the catalogue.

- **minor** (`worker/src/oauth.ts:231`) deny's UPDATE does not check expires_at again

  `deny` runs a SELECT (unused, unexpired), then `UPDATE ... WHERE request_id = ? AND used_at IS NULL`. A request that expires between the two statements can still be denied. The only effect is an access_denied redirect for a request that just expired: no grant, no second write, since `used_at IS NULL` stops a concurrent callback or deny from writing too. The approve path does check `expires_at > ?` in its UPDATE.

- **minor** (`worker/src/oauth.ts:266`) approve redirects without client_id when GOOGLE_CLIENT_ID is unset

  `redirectTo` drops undefined values, so an unset `GOOGLE_CLIENT_ID` sends the user to Google with no `client_id`. The ID token check refuses that case later anyway. The stack always sets the variable, so this does no harm in practice, but a 502/500 page at approve would be clearer.

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

  10.1: both protected-resource paths and the AS metadata are built from PUBLIC_URL. 10.2: register checks the fields in the documented precedence (unparseable JSON gives invalid_request per 6.1), the client_id is 32 characters, and auth.client.registered is logged. 10.3: unknown client or non-exact redirect_uri gives a 400 page with no redirect; the redirect errors follow spec order (response_type, PKCE, resource, scope); the consent page escapes name, redirect URI and scope, and has the hidden `request` input and two decision buttons; deny is a conditional UPDATE, then access_denied; approve sends every parameter. 10.4: the state is used up by one atomic `UPDATE ... WHERE used_at IS NULL AND expires_at > ? RETURNING` (no double use under concurrency), then the Google error, then the token exchange with the secret in the body, then the RS256/iss/aud/exp/nonce checks, then access control (email_verified, admin, invite). The users upsert, the invite update and the code insert run in one D1 batch, each carrying the admission condition, so a revocation that lands between the check and the writes still gives the 403 page and no row. The refresh token is AES-GCM with a random IV in `v1:` format. Nothing out of scope (no /token, /mcp, sessions) is implemented. One minor deviation: the extra log reason `server_error`.

- met: The change is covered by tests that fail without it.

  worker/tests/worker/oauth.test.ts and both e2e specs are new and target routes that did not exist before (the base answered 404). They cover each 10.2/10.3 error in order, the escaped name and the two buttons, deny → access_denied, approve's parameters, bad state, signature, aud, nonce, iss and exp, invited and admin rows with their roles, the non-invited/revoked/unverified 403 with no row, no clear refresh token in any table, and the log events. E2E-29 is in the api project; the consent → sign-in → code flow and E2E-02 are in the browser project. The browser redirect URI is now on the Worker's own port, which fixes the ERR_UNSAFE_PORT failure of PR #28. All five checks are reported green.

- met: Every choice the spec leaves open is written down in docs/decisions.md.

  Nine dated lines cover: the hand-written server and PUBLIC_URL fallback, register error mapping and client_id format, scope strictness, decision handling and repeated approve, discovery failure (502) and no cache, callback denial reasons, the aud array and missing nonce, keeping a stored refresh token, accepted_user_sub, the browser redirect URI, invalid_request vs invalid_client_metadata, the batch admission condition, encryption failure, and frame-ancestors.

## Proposed learnings (not decided)

- Chromium refuses navigation to restricted ports such as 9 (ERR_UNSAFE_PORT). Browser e2e redirect URIs should point to an allowed port, for example the Worker's own.
- When a check comes before the writes it guards (invite read, then users/code inserts), repeat the condition inside every write of a single D1 batch, so a concurrent revocation cannot slip in between.
- Single-use OAuth state is best consumed with one `UPDATE ... WHERE used_at IS NULL AND expires_at > ? RETURNING`, never a SELECT followed by an UPDATE.
- When the spec gives a closed list of log attribute values, check new values against it even when the case itself is a documented open choice.
