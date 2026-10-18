# Checks

Replayed by Ariane on commit `1cb554e929ea32dbcc5c9c4ae89e08ce2c330ecb`.

Each check was replayed in its own clean working tree at `1cb554e929ea32dbcc5c9c4ae89e08ce2c330ecb`, after the setup.

| Check | Blocking | Result | Duration |
| --- | --- | --- | --- |
| lint | yes | pass | 15.3 s |
| contracts | yes | pass | 0.1 s |
| test-node | yes | pass | 11.6 s |
| test-worker | yes | pass | 10.6 s |
| e2e | yes | pass | 24.0 s |

## lint

- Command: `./scripts/check.sh lint`
- Blocking: yes
- Result: passed (exit 0, 15.3 s)

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
- Result: passed (exit 0, 11.6 s)

```text
(23 earlier lines omitted)
 + typing-inspection==0.4.4
 + yt-digest-node==0.1.0 (from file:///home/user/yt-digest-a1-r2.ariane/worktrees/21-replay-3/node)
 + yt-dlp==2026.8.19
============================= test session starts ==============================
platform linux -- Python 3.12.3, pytest-9.1.1, pluggy-1.7.0
rootdir: /home/user/yt-digest-a1-r2.ariane/worktrees/21-replay-3/node
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

============================= 127 passed in 10.37s =============================
```

## test-worker

- Command: `./scripts/check.sh test-worker`
- Blocking: yes
- Result: passed (exit 0, 10.6 s)

```text
(746 earlier lines omitted)

[90mstdout[2m | tests/worker/results.test.ts[2m > [22m[2mDELETE /ops/nodes/<node_id>[2m > [22m[2ma revoked lease on the third attempt gives failed_video; again is the same 200; unknown is 404; 401 without the ops token
[22m[39m{"ts":"2026-10-16T07:00:00.000Z","service":"worker","event":"job.enqueued","attrs":{"count":1,"priority":0},"level":"info"}

[90mstdout[2m | tests/worker/results.test.ts[2m > [22m[2mDELETE /ops/nodes/<node_id>[2m > [22m[2ma revoked lease on the third attempt gives failed_video; again is the same 200; unknown is 404; 401 without the ops token
[22m[39m{"ts":"2026-10-16T07:00:00.000Z","service":"worker","event":"job.claimed","attrs":{"node_id":"c","attempt":3,"lease_seconds":10},"video_id":"video000001","level":"info"}

[90mstdout[2m | tests/worker/results.test.ts[2m > [22m[2mDELETE /ops/nodes/<node_id>[2m > [22m[2ma revoked lease on the third attempt gives failed_video; again is the same 200; unknown is 404; 401 without the ops token
[22m[39m{"ts":"2026-10-16T07:00:00.000Z","service":"worker","event":"node.revoked","attrs":{"node_id":"c","leases_revoked":1},"level":"info"}

[90mstdout[2m | tests/worker/results.test.ts[2m > [22m[2mDELETE /ops/nodes/<node_id>[2m > [22m[2ma revoked lease on the third attempt gives failed_video; again is the same 200; unknown is 404; 401 without the ops token
[22m[39m{"ts":"2026-10-16T07:00:00.000Z","service":"worker","event":"auth.bearer.rejected","attrs":{"surface":"ops","reason":"missing"},"level":"warn"}

 [32m✓[39m [30m[46m worker [49m[39m tests/worker/results.test.ts [2m([22m[2m28 tests[22m[2m)[22m[33m 1073[2mms[22m[39m

[2m Test Files [22m [1m[32m5 passed[39m[22m[90m (5)[39m
[2m      Tests [22m [1m[32m106 passed[39m[22m[90m (106)[39m
[2m   Start at [22m 06:41:56
[2m   Duration [22m 2.64s[2m (transform 490ms, setup 473ms, import 873ms, tests 1.56s, environment 0ms)[22m
```

## e2e

- Command: `./scripts/check.sh e2e`
- Blocking: yes
- Result: passed (exit 0, 24.0 s)

```text
(52 earlier lines omitted)
5 high severity vulnerabilities

To address all issues (including breaking changes), run:
  npm audit fix --force

Run `npm audit` for details.
stack: ready http://127.0.0.1:8787

Running 8 tests using 1 worker

  ✓  1 [api] › tests/health.api.spec.ts:5:1 › the Worker answers /health (33ms)
  ✓  2 [api] › tests/health.api.spec.ts:11:1 › the mocks server answers /health (9ms)
  ✓  3 [api] › tests/health.api.spec.ts:17:1 › SponsorBlock has no segment for any video (11ms)
  ✓  4 [api] › tests/jobs.api.spec.ts:45:1 › E2E-13: 2 nodes claim 6 jobs concurrently, each job is handed out once and all 6 end done (334ms)
  ✓  5 [api] › tests/jobs.api.spec.ts:72:1 › E2E-14: an expired lease goes to another node and the first node's late result gets 409 (5.4s)
  ✓  6 [api] › tests/jobs.api.spec.ts:93:1 › E2E-16: unavailable on 3 nodes gives failed_video and a 4th node gets nothing (160ms)
  ✓  7 [api] › tests/jobs.api.spec.ts:110:1 › E2E-20: a revoked node is refused and its job is reassigned (102ms)
  ✓  8 [api] › tests/jobs.api.spec.ts:130:1 › E2E-21: /node/* responses hold no user data (106ms)

  8 passed (6.9s)
```

Summary: 5 passed, 0 failed (0 blocking).
