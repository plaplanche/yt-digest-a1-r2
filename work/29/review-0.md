# Review 0

- Reviewed commit: `7f3b417b605aae06c44f03362dc957586366e992`
- Reviewer model: claude-opus-5-5
- Verdict: **no-go** (the reviewer answered no-go)

## Findings

- **blocking** (`e2e/tests/oauth.browser.spec.ts:8`) The fix for PR #28's browser failure is unproven, and the redirect URI uses a port Chromium blocks

  PR #28 failed in CI because Chromium ended on chrome-error:// at the redirect to http://127.0.0.1:9/cb. The new attempt keeps that same redirect URI and adds a page.route that fulfills it. Port 9 (discard) is on Chromium's list of restricted ports, so the navigation can fail with net::ERR_UNSAFE_PORT. Whether a Playwright route intercepts the request before that check is not shown anywhere. The decisions.md line names "nothing listens" as the cause and does not mention the unsafe port. The replayed e2e check proves nothing for the browser project: scripts/checks/e2e.sh runs only `--project=api` when Chromium cannot be installed outside CI, and the ticket says the agent's environment cannot run browser tests. No CI run of this commit is given. The acceptance criterion "the CI run is green with the five jobs", with the browser tests running in CI, is therefore not shown to be met, and the exact failure of the previous attempt may still happen. Fix: use a redirect URI on a port Chromium allows (for example a high port, or a path served by the mocks server), keep the route if useful, and show a green CI e2e run that includes the browser project.

- **minor** (`worker/src/oauth.ts:101`) A body that is not valid JSON on POST /register gives invalid_client_metadata, but 6.1 says invalid_request

  Spec 6.1: "A request body the endpoint cannot parse as JSON ... gives 400 invalid_request." Section 10.2 covers only invalid fields. The code (and the decisions.md line) answers invalid_client_metadata for unparseable JSON. The test at oauth.test.ts only checks the 400 status. A decision line cannot override a rule the spec states. Either follow 6.1 for unparseable JSON, or explain in the decision why 10.2 takes precedence.

- **minor** (`worker/src/oauth.ts:290`) The aud check passes when GOOGLE_CLIENT_ID is unset

  `aud = [claims.aud]` and `aud.includes(env.GOOGLE_CLIENT_ID)`: if GOOGLE_CLIENT_ID is missing from the config and the token has no aud, `[undefined].includes(undefined)` is true. Reject the token when GOOGLE_CLIENT_ID is unset or empty. The issuer check behaves the same way when GOOGLE_ISSUER is unset and the token has no iss.

- **minor** (`worker/src/oauth.ts:379`) An encryption error after the state is used up gives an unhandled 500

  The callback consumes the pending authorization first, as 10.4 step 1 requires. After that, `encrypt` with a missing or invalid TOKEN_ENC_KEY throws outside any try. The user gets an unhandled 500 instead of a redirect to the client with server_error, and nothing is logged. This only happens with a bad config, but it should fail cleanly.

- **minor** (`worker/src/oauth.ts:372`) The admission check and the users write are separate statements

  The SELECT on invites and the D1 batch that writes users, invites and oauth_codes are separate. If POST /ops/invites/revoke runs between them, the user still gets a row and a code. The result is the same as the serial order "callback, then revoke", and 10.6 checks admission again on every token use, so this is not a broken guarantee. Folding the invite condition into the batch, for example an INSERT ... SELECT guarded by `revoked = 0`, would close the gap. The `UPDATE invites SET accepted_user_sub` also does not filter on `revoked = 0`.

- **minor** (`worker/src/oauth.ts:38`) The consent page sends no frame-ancestors or X-Frame-Options header

  Another site could frame the consent page and trick a user into clicking Approve (clickjacking). The spec does not require the header, but adding `Content-Security-Policy: frame-ancestors 'none'` costs nothing.

- **minor** (`worker/tests/worker/oauth.test.ts:187`) No test for a register body with both an invalid redirect_uris and another invalid field

  The code checks redirect_uris first, but no test pins which error a body with two invalid fields gets. The ticket asks for each error case "in its order".

- **blocking** Definition of done not met: The change does what the ticket and spec/lot-2.md (and spec/lot-1.md, which still applies) say, and nothing more.

  Discovery (10.1), registration (10.2), authorize and consent (10.3), the callback with its ID-token checks, access control and 403 page (10.4), AES-GCM `v1:` encryption (6.3) and the three log events (12) are built, and the routes are wired in worker/src/index.ts. The order of side effects is correct: the callback uses up the request with one UPDATE ... RETURNING before calling Google, the user, invite and code writes are one D1 batch, and deny and approve are guarded by `used_at IS NULL`. Nothing from the token endpoint or /mcp is included. But the ticket's own criterion, a green CI run with the browser project, is not shown, and the redirect URI on 127.0.0.1:9 is a port Chromium restricts. Unparseable JSON on /register also departs from 6.1 (minor).

- **blocking** Definition of done not met: The change is covered by tests that fail without it.

  worker/tests/worker/oauth.test.ts covers every case the ticket lists: the 10.2 errors, the 10.3 error order and the no-redirect cases, escaping and the two buttons, deny giving access_denied, every Google parameter on approve, a bad state, signature, aud and nonce, iss, exp and alg, invited and admin rows, the non-invited, revoked and unverified 403 with no row, the encrypted refresh token, and the log events. oauth.api.spec.ts covers E2E-29. The browser tests (consent and sign-in flow, E2E-02) were not run in the replayed checks, because e2e.sh skips them without Chromium, and no CI run is given, so they are not shown to pass.

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

  Discovery (10.1), registration (10.2), authorize and consent (10.3), the callback with its ID-token checks, access control and 403 page (10.4), AES-GCM `v1:` encryption (6.3) and the three log events (12) are built, and the routes are wired in worker/src/index.ts. The order of side effects is correct: the callback uses up the request with one UPDATE ... RETURNING before calling Google, the user, invite and code writes are one D1 batch, and deny and approve are guarded by `used_at IS NULL`. Nothing from the token endpoint or /mcp is included. But the ticket's own criterion, a green CI run with the browser project, is not shown, and the redirect URI on 127.0.0.1:9 is a port Chromium restricts. Unparseable JSON on /register also departs from 6.1 (minor).

- **not met**: The change is covered by tests that fail without it.

  worker/tests/worker/oauth.test.ts covers every case the ticket lists: the 10.2 errors, the 10.3 error order and the no-redirect cases, escaping and the two buttons, deny giving access_denied, every Google parameter on approve, a bad state, signature, aud and nonce, iss, exp and alg, invited and admin rows, the non-invited, revoked and unverified 403 with no row, the encrypted refresh token, and the log events. oauth.api.spec.ts covers E2E-29. The browser tests (consent and sign-in flow, E2E-02) were not run in the replayed checks, because e2e.sh skips them without Chromium, and no CI run is given, so they are not shown to pass.

- met: Every choice the spec leaves open is written down in docs/decisions.md.

  Seven dated lines were added: hand-written server and PUBLIC_URL fallback, register error mapping and client_id format, the scope rule and repeatable approve, the 502 page and no discovery cache, the callback deny reasons and the aud-as-array rule, keeping a stored refresh token, and the browser route.

## Proposed learnings (not decided)

- When the previous attempt failed only in CI's browser project and the agent cannot run browsers, ask for a CI run of the new commit before giving a go; locally, e2e.sh skips the browser project, so a green local e2e says nothing about it.
- Chromium refuses some ports as unsafe (1, 7, 9, 11, ... 6000, 6665-6669); never use them as a fake redirect_uri in browser tests.
- A decisions.md line cannot override a rule the spec states (for example 6.1's invalid_request for unparseable JSON); check each decision against the general sections, not only the section it is about.
