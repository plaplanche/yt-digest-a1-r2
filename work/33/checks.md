# Checks

Replayed by Ariane on commit `a181b3f9896c667ba8cb4baf7bac956a30fd09a2`.

Each check was replayed in its own clean working tree at `a181b3f9896c667ba8cb4baf7bac956a30fd09a2`, after the setup.

| Check | Blocking | Result | Duration |
| --- | --- | --- | --- |
| lint | yes | pass | 21.7 s |
| contracts | yes | pass | 0.1 s |
| test-node | yes | pass | 19.3 s |
| test-worker | yes | pass | 13.2 s |
| e2e | yes | pass | 29.0 s |

## lint

- Command: `./scripts/check.sh lint`
- Blocking: yes
- Result: passed (exit 0, 21.7 s)

```text
(29 earlier lines omitted)
npm warn deprecated @cloudflare/vitest-pool-workers@0.23.0: @cloudflare/vitest-pool-workers has been renamed to @cloudflare/vitest-plugin. This package will not receive future updates.

added 198 packages, and audited 199 packages in 7s

63 packages are looking for funding
  run `npm fund` for details

5 high severity vulnerabilities

To address all issues (including breaking changes), run:
  npm audit fix --force

Run `npm audit` for details.

added 104 packages, and audited 105 packages in 1s

30 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities
```

## contracts

- Command: `./scripts/check.sh contracts`
- Blocking: yes
- Result: passed (exit 0, 0.1 s)

```text
== contracts
```

## test-node

- Command: `./scripts/check.sh test-node`
- Blocking: yes
- Result: passed (exit 0, 19.3 s)

```text
(24 earlier lines omitted)
 + yt-digest-node==0.1.0 (from file:///home/user/yt-digest-a1-r2.ariane/worktrees/33-replay-3/node)
 + yt-dlp==2026.8.19
============================= test session starts ==============================
platform linux -- Python 3.12.3, pytest-9.1.1, pluggy-1.7.0
rootdir: /home/user/yt-digest-a1-r2.ariane/worktrees/33-replay-3/node
configfile: pyproject.toml
collected 136 items

node/tests/test_cli.py ...........                                       [  8%]
node/tests/test_contracts.py ........................................... [ 39%]
............                                                             [ 48%]
node/tests/test_daemon.py .........                                      [ 55%]
node/tests/test_extractors.py ..................                         [ 68%]
node/tests/test_log.py ........                                          [ 74%]
node/tests/test_pages.py ......                                          [ 78%]
node/tests/test_placeholder.py .                                         [ 79%]
node/tests/test_sponsorblock.py ..............                           [ 89%]
node/tests/test_vtt.py ..............                                    [100%]

============================= 136 passed in 17.99s =============================
```

## test-worker

- Command: `./scripts/check.sh test-worker`
- Blocking: yes
- Result: passed (exit 0, 13.2 s)

```text
(1016 earlier lines omitted)

[90mstdout[2m | tests/worker/worker.test.ts[2m > [22m[2moperator authentication[2m > [22m[2m401 without bearer or with a wrong one, whatever the body
[22m[39m{"ts":"2026-10-18T08:39:12.296Z","service":"worker","event":"auth.bearer.rejected","attrs":{"surface":"ops","reason":"missing"},"level":"warn"}

[90mstdout[2m | tests/worker/worker.test.ts[2m > [22m[2moperator authentication[2m > [22m[2m401 without bearer or with a wrong one, whatever the body
[22m[39m{"ts":"2026-10-18T08:39:12.296Z","service":"worker","event":"auth.bearer.rejected","attrs":{"surface":"ops","reason":"missing"},"level":"warn"}

[90mstdout[2m | tests/worker/worker.test.ts[2m > [22m[2moperator authentication[2m > [22m[2m401 without bearer or with a wrong one, whatever the body
[22m[39m{"ts":"2026-10-18T08:39:12.296Z","service":"worker","event":"auth.bearer.rejected","attrs":{"surface":"ops","reason":"missing"},"level":"warn"}

[90mstdout[2m | tests/worker/worker.test.ts[2m > [22m[2moperator authentication[2m > [22m[2mPOST /ops/reset[2m > [22m[2mdoes nothing when unauthenticated
[22m[39m{"ts":"2026-10-18T08:39:12.363Z","service":"worker","event":"auth.bearer.rejected","attrs":{"surface":"ops","reason":"missing"},"level":"warn"}

 [32m✓[39m [30m[46m worker [49m[39m tests/worker/worker.test.ts [2m([22m[2m18 tests[22m[2m)[22m[32m 121[2mms[22m[39m

[2m Test Files [22m [1m[32m8 passed[39m[22m[90m (8)[39m
[2m      Tests [22m [1m[32m174 passed[39m[22m[90m (174)[39m
[2m   Start at [22m 08:39:08
[2m   Duration [22m 4.21s[2m (transform 782ms, setup 1.17s, import 1.26s, tests 3.41s, environment 1ms)[22m
```

## e2e

- Command: `./scripts/check.sh e2e`
- Blocking: yes
- Result: passed (exit 0, 29.0 s)

```text
(67 earlier lines omitted)
  ✓   6 [api] › tests/google.api.spec.ts:96:1 › a wrong client secret gives 401 invalid_client; HTTP Basic works (16ms)
  ✓   7 [api] › tests/google.api.spec.ts:108:1 › access_type=offline gives a refresh token that refreshes (15ms)
  ✓   8 [api] › tests/google.api.spec.ts:122:1 › userinfo answers for its access token only (15ms)
  ✓   9 [api] › tests/google.api.spec.ts:136:1 › revoke answers 200 (11ms)
  ✓  10 [api] › tests/health.api.spec.ts:5:1 › the Worker answers /health (13ms)
  ✓  11 [api] › tests/health.api.spec.ts:11:1 › the mocks server answers /health (6ms)
  ✓  12 [api] › tests/health.api.spec.ts:17:1 › SponsorBlock has no segment for any video (6ms)
  ✓  13 [api] › tests/jobs.api.spec.ts:45:1 › E2E-13: 2 nodes claim 6 jobs concurrently, each job is handed out once and all 6 end done (332ms)
  ✓  14 [api] › tests/jobs.api.spec.ts:72:1 › E2E-14: an expired lease goes to another node and the first node's late result gets 409 (5.4s)
  ✓  15 [api] › tests/jobs.api.spec.ts:93:1 › E2E-16: unavailable on 3 nodes gives failed_video and a 4th node gets nothing (208ms)
  ✓  16 [api] › tests/jobs.api.spec.ts:110:1 › E2E-20: a revoked node is refused and its job is reassigned (119ms)
  ✓  17 [api] › tests/jobs.api.spec.ts:130:1 › E2E-21: /node/* responses hold no user data (146ms)
  ✓  18 [api] › tests/mcp.api.spec.ts:49:1 › E2E-27: /mcp without a token gets 401 and WWW-Authenticate; the discovery documents are consistent (47ms)
  ✓  19 [api] › tests/mcp.api.spec.ts:68:1 › E2E-33: a revoked invite refuses the user's valid access token (154ms)
  ✓  20 [api] › tests/mcp.api.spec.ts:78:1 › E2E-37: a node token on /mcp and an access token on /node/* are refused (124ms)
  ✓  21 [api] › tests/node.api.spec.ts:9:1 › the node daemon processes a queued video and its transcript is readable (994ms)
  ✓  22 [api] › tests/oauth.api.spec.ts:28:1 › E2E-29: no PKCE, plain PKCE and a non-exact redirect_uri are refused (84ms)
  ✓  23 [api] › tests/token.api.spec.ts:46:1 › E2E-31: refresh rotation, and the reuse of an old refresh token revokes the family (137ms)

  23 passed (9.1s)
```

Summary: 5 passed, 0 failed (0 blocking).
