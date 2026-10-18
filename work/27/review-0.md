# Review 0

- Reviewed commit: `b9dc76950a9100271cdf56f596cf4e0c288b1450`
- Reviewer model: claude-opus-5-5
- Verdict: **no-go** (the reviewer answered no-go)

## Findings

- **blocking** (`worker/src/oauth.ts:300`) Callback admission check and the users/code writes are separate statements, so a concurrent invite revoke can slip in between

  In callback() the writes happen in this order: (1) a conditional UPDATE oauth_requests SET used_at … RETURNING (atomic, fine); (2) external calls to Google discovery, the token endpoint and JWKS; (3) SELECT 1 FROM invites WHERE email = ? AND revoked = 0 (line ~300); (4) the email_verified and invite checks in JS; (5) env.DB.batch([INSERT/UPSERT users, UPDATE invites SET accepted_user_sub … AND revoked = 0, INSERT oauth_codes]) (line ~317). The decision in step 3 and the writes in step 5 are separate statements. Interleaving: callback A runs step 3 and sees an active invite for bob. Then POST /ops/invites/revoke commits revoked = 1. Then A runs step 5: the users row is upserted with role member and an authorization code is issued for a user who is no longer invited. Only the invites UPDATE is skipped, because it is conditioned on revoked = 0, so the database ends up inconsistent: a users row with no accepted_user_sub. Spec 10.4 step 4 says a non-admitted user gets the 403 page and 'no row is written to users'. Fix: make the admission part of the write itself, for example `INSERT INTO users … SELECT … WHERE ? OR EXISTS (SELECT 1 FROM invites WHERE email = ? AND revoked = 0)` plus an `INSERT INTO oauth_codes … SELECT … WHERE EXISTS (…)` in the same batch, and check the change counts to choose between the redirect and the 403. No test covers this interleaving.

- **minor** (`worker/src/oauth.ts:97`) Unparseable /register body gives invalid_client_metadata, not the invalid_request of 6.1, and this is not recorded

  Spec 6.1 says a body that cannot be parsed as JSON gives 400 invalid_request. register() answers invalid_client_metadata. The decisions.md line only covers 'a body that is not a JSON object', not a body that fails to parse. Either follow 6.1 or record the choice and the reason for it.

- **minor** (`worker/src/oauth.ts:198`) Approve binds google_state before fetching Google discovery, so a failed fetch leaves the request unusable

  consent() first writes google_state and google_nonce with a conditional UPDATE. Only then does it fetch GOOGLE_ISSUER's discovery document, outside any try. If that fetch fails, or GOOGLE_ISSUER is unset, the Worker throws a 500 and the pending authorization stays bound: retrying approve gives 400 and only deny still works. Nothing is written twice, but a transient upstream failure cannot be retried. Fetching the metadata before the UPDATE would avoid this.

- **minor** (`worker/src/oauth.ts:277`) A missing GOOGLE_ISSUER at the callback gives server_error, not the 500 recorded in decisions.md

  setting(env.GOOGLE_ISSUER) throws inside the callback's try/catch, so the answer is a server_error redirect, while decisions.md says a missing GOOGLE_ISSUER fails with a 500. In practice this path can't be reached, because approve already fails, but the recorded decision doesn't match the code.

- **minor** (`worker/tests/worker/oauth.test.ts:405`) The test 'a later login keeps the user row and updates the role' does not check the role

  It only asserts that there is one users row. Nothing checks that the role or e-mail is updated on a later login, or that an existing encrypted refresh token is kept when Google returns none (the COALESCE in the decision).

- **blocking** Definition of done not met: The change does what the ticket and spec/lot-2.md (and spec/lot-1.md, which still applies) say, and nothing more.

  Discovery (10.1), /register (10.2), /authorize, the consent page and /authorize/consent (10.3), the callback with its ID token checks and the 403 page (10.4), AES-GCM v1: encryption (6.3) and the three log events (12) are implemented, with no token endpoint or /mcp. But the access control of 10.4 step 4 is a SELECT followed by a separate batch, so a concurrent invite revoke can still produce a users row and a code for a non-admitted user (blocking finding). The non-JSON /register body also departs from 6.1.

- **blocking** Definition of done not met: Every choice the spec leaves open is written down in docs/decisions.md.

  Seven dated lines were added (fallbacks, register details, scope, consent reuse, deny reasons, unverified admin, discovery not cached). The invalid_client_metadata answer for a body that cannot be parsed, which departs from 6.1, is not recorded, and the GOOGLE_ISSUER 500 line does not match the callback's behaviour.

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

  Discovery (10.1), /register (10.2), /authorize, the consent page and /authorize/consent (10.3), the callback with its ID token checks and the 403 page (10.4), AES-GCM v1: encryption (6.3) and the three log events (12) are implemented, with no token endpoint or /mcp. But the access control of 10.4 step 4 is a SELECT followed by a separate batch, so a concurrent invite revoke can still produce a users row and a code for a non-admitted user (blocking finding). The non-JSON /register body also departs from 6.1.

- met: The change is covered by tests that fail without it.

  worker/tests/worker/oauth.test.ts covers every 10.2 and 10.3 error case and their order, the escaped consent page with two decision buttons, deny returning access_denied, every approve parameter, a bad state, signature, aud, iss, nonce and exp, the invited user and the admin with their roles, the 403 page with no row, the refresh token encrypted and absent in clear from every table, and the log attrs. e2e/tests/oauth.api.spec.ts covers E2E-29; oauth.browser.spec.ts covers the consent and sign-in flow and E2E-02. All checks are green. Gaps: no test for the concurrent revoke, and none for the role update.

- **not met**: Every choice the spec leaves open is written down in docs/decisions.md.

  Seven dated lines were added (fallbacks, register details, scope, consent reuse, deny reasons, unverified admin, discovery not cached). The invalid_client_metadata answer for a body that cannot be parsed, which departs from 6.1, is not recorded, and the GOOGLE_ISSUER 500 line does not match the callback's behaviour.

## Proposed learnings (not decided)

- In OAuth callbacks, put the admission check (invite or admin) inside the conditional INSERT itself (INSERT … SELECT … WHERE EXISTS) rather than a SELECT followed by a batch, so a concurrent revoke can't land in between.
- Do the fallible upstream fetches (discovery documents) before the conditional write that consumes or binds a single-use record, so a transient failure doesn't make the record unusable.
- When an endpoint-specific error code (RFC 7591's invalid_client_metadata) overrides the general 6.1 rule, record it in docs/decisions.md.
