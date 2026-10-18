# Checks

Replayed by Ariane on commit `8e70711106900c75494f6d87578a981c53a51a14`.

Each check was replayed in its own clean working tree at `8e70711106900c75494f6d87578a981c53a51a14`, after the setup.

| Check | Blocking | Result | Duration |
| --- | --- | --- | --- |
| lint | yes | pass | 16.0 s |
| contracts | yes | pass | 0.1 s |
| test-node | yes | pass | 12.3 s |
| test-worker | yes | pass | 9.4 s |
| e2e | yes | pass | 18.6 s |

## lint

- Command: `./scripts/check.sh lint`
- Blocking: yes
- Result: passed (exit 0, 16.0 s)

```text
(29 earlier lines omitted)
npm warn deprecated @cloudflare/vitest-pool-workers@0.23.0: @cloudflare/vitest-pool-workers has been renamed to @cloudflare/vitest-plugin. This package will not receive future updates.

added 198 packages, and audited 199 packages in 5s

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
- Result: passed (exit 0, 12.3 s)

```text
(23 earlier lines omitted)
 + typing-inspection==0.4.4
 + yt-digest-node==0.1.0 (from file:///home/user/yt-digest-a1-r2.ariane/worktrees/19-replay-3/node)
 + yt-dlp==2026.8.19
============================= test session starts ==============================
platform linux -- Python 3.12.3, pytest-9.1.1, pluggy-1.7.0
rootdir: /home/user/yt-digest-a1-r2.ariane/worktrees/19-replay-3/node
configfile: pyproject.toml
collected 127 items

node/tests/test_cli.py ...........                                       [  8%]
node/tests/test_contracts.py ........................................... [ 42%]
............                                                             [ 51%]
node/tests/test_extractors.py ..................                         [ 66%]
node/tests/test_log.py ........                                          [ 72%]
node/tests/test_pages.py ......                                          [ 77%]
node/tests/test_placeholder.py .                                         [ 77%]
node/tests/test_sponsorblock.py ..............                           [ 88%]
node/tests/test_vtt.py ..............                                    [100%]

============================= 127 passed in 10.87s =============================
```

## test-worker

- Command: `./scripts/check.sh test-worker`
- Blocking: yes
- Result: passed (exit 0, 9.4 s)

```text
(235 earlier lines omitted)
[90mstdout[2m | tests/worker/worker.test.ts[2m > [22m[2moperator authentication[2m > [22m[2m401 without bearer or with a wrong one, whatever the body
[22m[39m{"ts":"2026-10-18T06:20:51.995Z","service":"worker","event":"auth.bearer.rejected","attrs":{"surface":"ops","reason":"missing"},"level":"warn"}

[90mstdout[2m | tests/worker/worker.test.ts[2m > [22m[2moperator authentication[2m > [22m[2m401 without bearer or with a wrong one, whatever the body
[22m[39m{"ts":"2026-10-18T06:20:51.996Z","service":"worker","event":"auth.bearer.rejected","attrs":{"surface":"ops","reason":"missing"},"level":"warn"}

[90mstdout[2m | tests/worker/worker.test.ts[2m > [22m[2moperator authentication[2m > [22m[2m401 without bearer or with a wrong one, whatever the body
[22m[39m{"ts":"2026-10-18T06:20:51.996Z","service":"worker","event":"auth.bearer.rejected","attrs":{"surface":"ops","reason":"missing"},"level":"warn"}

 [32m✓[39m [30m[46m worker [49m[39m tests/worker/nodes.test.ts [2m([22m[2m16 tests[22m[2m)[22m[32m 286[2mms[22m[39m
[90mstdout[2m | tests/worker/worker.test.ts[2m > [22m[2moperator authentication[2m > [22m[2mPOST /ops/reset[2m > [22m[2mdoes nothing when unauthenticated
[22m[39m{"ts":"2026-10-18T06:20:52.060Z","service":"worker","event":"auth.bearer.rejected","attrs":{"surface":"ops","reason":"missing"},"level":"warn"}

 [32m✓[39m [30m[46m worker [49m[39m tests/worker/worker.test.ts [2m([22m[2m18 tests[22m[2m)[22m[32m 110[2mms[22m[39m

[2m Test Files [22m [1m[32m4 passed[39m[22m[90m (4)[39m
[2m      Tests [22m [1m[32m78 passed[39m[22m[90m (78)[39m
[2m   Start at [22m 06:20:50
[2m   Duration [22m 1.60s[2m (transform 379ms, setup 237ms, import 834ms, tests 441ms, environment 1ms)[22m
```

## e2e

- Command: `./scripts/check.sh e2e`
- Blocking: yes
- Result: passed (exit 0, 18.6 s)

```text
(48 earlier lines omitted)

63 packages are looking for funding
  run `npm fund` for details

5 high severity vulnerabilities

To address all issues (including breaking changes), run:
  npm audit fix --force

Run `npm audit` for details.
stack: ready http://127.0.0.1:8787

Running 4 tests using 1 worker

  ✓  1 [api] › tests/claims.api.spec.ts:11:1 › 2 nodes claim 6 jobs concurrently and each job is handed out once (151ms)
  ✓  2 [api] › tests/health.api.spec.ts:5:1 › the Worker answers /health (17ms)
  ✓  3 [api] › tests/health.api.spec.ts:11:1 › the mocks server answers /health (11ms)
  ✓  4 [api] › tests/health.api.spec.ts:17:1 › SponsorBlock has no segment for any video (6ms)

  4 passed (964ms)
```

Summary: 5 passed, 0 failed (0 blocking).
