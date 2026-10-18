# Review 0

- Reviewed commit: `a181b3f9896c667ba8cb4baf7bac956a30fd09a2`
- Reviewer model: claude-opus-5-5
- Verdict: **go**

## Findings

- **minor** (`worker/src/mcp.ts:20`) An empty ALLOWED_ORIGINS lets an empty Origin header through

  When ALLOWED_ORIGINS is unset or empty (the default in stack.sh), `"".split(",")` returns `[""]`, so the allowed list contains "". A request with an `Origin` header whose value is empty is then accepted. Under 11.2, a request that has an Origin header which is neither BASE's origin nor one of ALLOWED_ORIGINS should get 403. Browsers never send an empty Origin, so the risk is small, but empty entries should be dropped (`.filter(Boolean)`), and the case is not tested.

- **minor** (`docs/decisions.md:77`) The decision says origins are compared exactly, but the code strips trailing slashes

  The decision says `ALLOWED_ORIGINS` entries are "trimmed and compared exactly". The code also removes trailing `/` from each entry (`replace(/\/+$/, "")`). The decision should describe what the code really does.

- **minor** (`worker/src/mcp.ts:26`) auth.bearer.rejected on /mcp never logs `expired` or `revoked`

  The section 12 catalogue lists the reasons `missing`, `unknown`, `expired` and `revoked`. An expired access token, or one whose invite was revoked, is logged as `unknown` because verifyAccessToken returns only null. This is written down in decisions.md and the spec does not require a specific mapping, but the log is less useful than the catalogue allows.

- **minor** (`worker/src/index.ts:180`) GET /mcp without a token gets 404, not 401 with WWW-Authenticate

  Only POST is routed, so GET /mcp falls through to 404 `not_found`. That matches 6.1 (a method not listed gives 404) and is written down. But 11.1 says "every /mcp request without a valid access token" gets 401, and MCP Streamable HTTP clients expect 405 when a server offers no SSE stream on GET. This is acceptable as written; 405 would be the more interoperable choice.

- **minor** (`worker/src/mcp.ts:48`) An unparseable /mcp body gives a JSON-RPC error instead of the 6.1 `invalid_request` body

  6.1 says a body that cannot be parsed as JSON gets 400 `invalid_request` (the 4.2 error body). /mcp answers HTTP 400 with a JSON-RPC error (-32700 or -32600) instead. Since 11.1 requires JSON-RPC 2.0, this is a defensible reading, and it is recorded in decisions.md.

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

  worker/src/mcp.ts adds POST /mcp. The Origin check runs first (403 `origin_rejected` from errorResponse, logs `auth.origin.rejected`). Then verifyAccessToken (10.6) runs, and a failure gives 401 `invalid_token` with `WWW-Authenticate: Bearer resource_metadata="BASE/.well-known/oauth-protected-resource"` and logs auth.bearer.rejected with surface `mcp`. Only then is the body parsed. Supported: initialize (protocolVersion 2025-06-18), notifications answered 202 with no body, ping, tools/list (only list_subscriptions, inputSchema an object with empty properties), and tools/call (text `{"subscriptions":[]}`, isError false, logs mcp.tool.call). The only writes are log lines, and each comes after the check that guards it, so no ordering or atomicity problem exists. No out-of-scope tools, admin scope or PATs were added. Remaining deviations are minor edge cases (see findings).

- met: The change is covered by tests that fail without it.

  worker/tests/worker/mcp.test.ts covers every acceptance case. Refused on /mcp: no token, an unknown token, an expired token, a token for another resource, a node token, the operator token and a revoked invite. Also tested: an access token refused on /node/heartbeat; a foreign Origin refused even with a valid token; BASE's origin, an allowed origin and no Origin all pass; initialize, the 202 notification, ping, tools/list, tools/call, and the logs. e2e/tests/mcp.api.spec.ts adds E2E-27, E2E-33 and E2E-37 (`api` project), and oauth.browser.spec.ts adds E2E-28 (`browser` project). The route did not exist before, so all of these fail without the change. All five checks are reported green.

- met: Every choice the spec leaves open is written down in docs/decisions.md.

  A new dated line in docs/decisions.md records: stateless with no Mcp-Session-Id, JSON-only answers, how a notification is detected, the JSON-RPC error codes and HTTP statuses, the auth.bearer.rejected reasons, routing POST only, and how origins are compared. Small gap: the trailing-slash stripping is not described (minor finding).

## Proposed learnings (not decided)

- When a comma-separated allow-list env var is split, drop empty entries: `"".split(",")` returns `[""]`, which can let an empty header value match.
- When the shared token check (verifyAccessToken) returns only null, the caller cannot log the specific `expired` or `revoked` reasons; decide early whether the log catalogue needs them.
- For MCP Streamable HTTP, decide explicitly how GET /mcp is answered (404 vs 405) and how JSON-RPC errors relate to the generic HTTP error conventions.
