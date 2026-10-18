# Review 0

- Reviewed commit: `406ec1eb08b4cd50100654b485477fa29d003e52`
- Reviewer model: claude-opus-5-5
- Verdict: **go**

## Findings

- **minor** (`e2e/mocks/server.ts:73`) A non-URL redirect_uri (or a bad %-escape in HTTP Basic) crashes the whole mocks server

  `new URL(redirectUri)` in `authorize` throws a TypeError when `redirect_uri` is not an absolute URL. `decodeURIComponent` in `exchange` (line 90) throws a URIError on a Basic credential such as `a%zz:b`. Both run inside `void (async () => {...})()`, so the error becomes an unhandled rejection. Node 22's default `--unhandled-rejections=throw` then ends the process, and the shared stack loses its fake Google for the rest of the e2e run. The Worker of the next ticket always sends a valid `BASE/callback`, so the normal flow does not hit this, which is why it is minor. Fix: answer 400 instead (try/catch around the handler, or check the URL before building it).

- **minor** (`docs/decisions.md:62`) The decision says any redirect_uri is accepted, but the code is stricter

  The line says `authorize` accepts any `redirect_uri` value and echoes it in the redirect. In fact only values that parse as absolute URLs work; anything else crashes the server (finding above). Either the decision or the code should be corrected so they agree.

- **minor** (`e2e/tests/google.api.spec.ts:59`) No test for the 60 s code lifetime or for refresh tokens being missing without access_type=offline on refresh

  Spec 5.3 says a code is valid for 60 s, and the code enforces it (`expiresAt`), but no test covers expiry. The acceptance criteria do not ask for one, so this is only a gap.

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

  All the 5.3 routes are in `e2e/mocks/server.ts`: discovery with the exact fields; authorize checks `client_id`, that `redirect_uri` is present, `response_type=code` and an `openid` scope, and answers 400 plain text otherwise; the sign-in form repeats each parameter as an escaped hidden input; with `login_hint` it answers 302 with `code` and `state`. The token endpoint accepts client credentials in the body or by Basic, returns 401 `invalid_client`, handles both grants, issues a refresh token only with `access_type=offline`, and returns 400 `invalid_grant` otherwise. The ID token is RS256 with the JWKS `kid` and the 5.3 claims; `sub` follows the subject rule on the lowercased e-mail. Userinfo, JWKS (2048-bit key generated at start) and revoke are present, and SponsorBlock still answers 404 through the fallback. On the code-exchange path, client auth runs first, then `codes.get` and `codes.delete` run synchronously before the validity checks. A failed client auth leaves the code unused; any exchange that reaches the code burns it. Node's single thread rules out a double exchange. Section 7: `/ops/invites` is one `INSERT … ON CONFLICT DO UPDATE SET revoked = 0` statement (atomic, re-activates a revoked invite); revoke is one `UPDATE` and returns 404 `not_found` when `changes === 0`; `/ops/users` runs `ORDER BY email`. These sit behind the existing ops auth, which runs before the body is read. No logging of e-mails, and no Worker OAuth routes.

- met: The change is covered by tests that fail without it.

  `e2e/tests/google.api.spec.ts` covers every e2e acceptance criterion: discovery, the 400 cases, the form repeating parameters, the redirect with `code` and `state`, JWKS signature verification, the claims including lowercased e-mail, subject rule and nonce, single use, 401 `invalid_client`, and userinfo. It also covers refresh, Basic auth and a wrong `redirect_uri`. The new `invites and users` describe block in `worker/tests/worker/nodes.test.ts` covers lowercasing, re-activation, 404 on revoking an unknown invite, 400 on a bad e-mail and the sorted user list. Without the change, all of these routes return 404, so the tests fail. Ariane's replayed checks are all green.

- met: Every choice the spec leaves open is written down in docs/decisions.md.

  Two new dated lines (62–63) record: the `redirect_uri` handling, a code burned on its first exchange attempt, no new refresh token or `nonce` on refresh, how the `kid` is derived, the revoke body, the issuer built from `MOCKS_PORT`, unknown keys rejected on the invite bodies, no log line, and lowercasing without trimming. One line overstates which `redirect_uri` values are accepted (minor finding).

## Proposed learnings (not decided)

- In a Node `http` server whose handler is `void (async () => …)()`, any throw (`new URL`, `decodeURIComponent`, `JSON.parse`) is an unhandled rejection that kills the process; wrap the handler in try/catch so a bad request gets a 4xx.
- For single-use codes, check where the code gets consumed relative to client authentication: here a wrong client secret leaves the code unused, and any exchange that reaches the code check burns it.
