# Checks

Replayed by Ariane on commit `8e3d301c8b4122030116077581a05dfbcca03a35`.

Each check was replayed in its own clean working tree at `8e3d301c8b4122030116077581a05dfbcca03a35`, after the setup.

| Check | Blocking | Result | Duration |
| --- | --- | --- | --- |
| lint | yes | pass | 17.9 s |
| contracts | yes | pass | 0.1 s |
| test-node | yes | pass | 19.3 s |
| test-worker | yes | pass | 11.6 s |
| e2e | yes | pass | 28.5 s |

## lint

- Command: `./scripts/check.sh lint`
- Blocking: yes
- Result: passed (exit 0, 17.9 s)

```text
(29 earlier lines omitted)
npm warn deprecated @cloudflare/vitest-pool-workers@0.23.0: @cloudflare/vitest-pool-workers has been renamed to @cloudflare/vitest-plugin. This package will not receive future updates.

added 198 packages, and audited 199 packages in 6s

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
 + yt-digest-node==0.1.0 (from file:///home/user/yt-digest-a1-r2.ariane/worktrees/29-replay-3/node)
 + yt-dlp==2026.8.19
============================= test session starts ==============================
platform linux -- Python 3.12.3, pytest-9.1.1, pluggy-1.7.0
rootdir: /home/user/yt-digest-a1-r2.ariane/worktrees/29-replay-3/node
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

============================= 136 passed in 18.12s =============================
```

## test-worker

- Command: `./scripts/check.sh test-worker`
- Blocking: yes
- Result: passed (exit 0, 11.6 s)

```text
(897 earlier lines omitted)

[90mstdout[2m | tests/worker/worker.test.ts[2m > [22m[2moperator authentication[2m > [22m[2m401 without bearer or with a wrong one, whatever the body
[22m[39m{"ts":"2026-10-18T08:15:49.890Z","service":"worker","event":"auth.bearer.rejected","attrs":{"surface":"ops","reason":"missing"},"level":"warn"}

[90mstdout[2m | tests/worker/worker.test.ts[2m > [22m[2moperator authentication[2m > [22m[2m401 without bearer or with a wrong one, whatever the body
[22m[39m{"ts":"2026-10-18T08:15:49.890Z","service":"worker","event":"auth.bearer.rejected","attrs":{"surface":"ops","reason":"missing"},"level":"warn"}

[90mstdout[2m | tests/worker/worker.test.ts[2m > [22m[2moperator authentication[2m > [22m[2m401 without bearer or with a wrong one, whatever the body
[22m[39m{"ts":"2026-10-18T08:15:49.891Z","service":"worker","event":"auth.bearer.rejected","attrs":{"surface":"ops","reason":"missing"},"level":"warn"}

[90mstdout[2m | tests/worker/worker.test.ts[2m > [22m[2moperator authentication[2m > [22m[2mPOST /ops/reset[2m > [22m[2mdoes nothing when unauthenticated
[22m[39m{"ts":"2026-10-18T08:15:49.956Z","service":"worker","event":"auth.bearer.rejected","attrs":{"surface":"ops","reason":"missing"},"level":"warn"}

 [32m✓[39m [30m[46m worker [49m[39m tests/worker/worker.test.ts [2m([22m[2m18 tests[22m[2m)[22m[32m 110[2mms[22m[39m

[2m Test Files [22m [1m[32m6 passed[39m[22m[90m (6)[39m
[2m      Tests [22m [1m[32m141 passed[39m[22m[90m (141)[39m
[2m   Start at [22m 08:15:46
[2m   Duration [22m 3.20s[2m (transform 642ms, setup 739ms, import 1.20s, tests 2.81s, environment 0ms)[22m
```

## e2e

- Command: `./scripts/check.sh e2e`
- Blocking: yes
- Result: passed (exit 0, 28.5 s)

```text
(63 earlier lines omitted)
  ✓   2 [api] › tests/google.api.spec.ts:41:1 › authorize refuses a wrong client_id and a missing openid scope (19ms)
  ✓   3 [api] › tests/google.api.spec.ts:47:1 › authorize shows a sign-in form repeating every parameter (11ms)
  ✓   4 [api] › tests/google.api.spec.ts:58:1 › the code gives a signed ID token with the claims of 5.3, and is single use (37ms)
  ✓   5 [api] › tests/google.api.spec.ts:90:1 › a wrong redirect_uri gives invalid_grant (22ms)
  ✓   6 [api] › tests/google.api.spec.ts:96:1 › a wrong client secret gives 401 invalid_client; HTTP Basic works (25ms)
  ✓   7 [api] › tests/google.api.spec.ts:108:1 › access_type=offline gives a refresh token that refreshes (28ms)
  ✓   8 [api] › tests/google.api.spec.ts:122:1 › userinfo answers for its access token only (22ms)
  ✓   9 [api] › tests/google.api.spec.ts:136:1 › revoke answers 200 (7ms)
  ✓  10 [api] › tests/health.api.spec.ts:5:1 › the Worker answers /health (13ms)
  ✓  11 [api] › tests/health.api.spec.ts:11:1 › the mocks server answers /health (6ms)
  ✓  12 [api] › tests/health.api.spec.ts:17:1 › SponsorBlock has no segment for any video (5ms)
  ✓  13 [api] › tests/jobs.api.spec.ts:45:1 › E2E-13: 2 nodes claim 6 jobs concurrently, each job is handed out once and all 6 end done (355ms)
  ✓  14 [api] › tests/jobs.api.spec.ts:72:1 › E2E-14: an expired lease goes to another node and the first node's late result gets 409 (5.4s)
  ✓  15 [api] › tests/jobs.api.spec.ts:93:1 › E2E-16: unavailable on 3 nodes gives failed_video and a 4th node gets nothing (166ms)
  ✓  16 [api] › tests/jobs.api.spec.ts:110:1 › E2E-20: a revoked node is refused and its job is reassigned (119ms)
  ✓  17 [api] › tests/jobs.api.spec.ts:130:1 › E2E-21: /node/* responses hold no user data (131ms)
  ✓  18 [api] › tests/node.api.spec.ts:9:1 › the node daemon processes a queued video and its transcript is readable (818ms)
  ✓  19 [api] › tests/oauth.api.spec.ts:28:1 › E2E-29: no PKCE, plain PKCE and a non-exact redirect_uri are refused (92ms)

  19 passed (8.4s)
```

Summary: 5 passed, 0 failed (0 blocking).
