# Checks

Replayed by Ariane on commit `8895c011458ec63e150188f46f978c8ff39fd8d9`.

Each check was replayed in its own clean working tree at `8895c011458ec63e150188f46f978c8ff39fd8d9`, after the setup.

| Check | Blocking | Result | Duration |
| --- | --- | --- | --- |
| lint | yes | pass | 15.8 s |
| contracts | yes | pass | 0.1 s |
| test-node | yes | pass | 11.6 s |
| test-worker | yes | pass | 9.7 s |
| e2e | yes | pass | 18.9 s |

## lint

- Command: `./scripts/check.sh lint`
- Blocking: yes
- Result: passed (exit 0, 15.8 s)

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
- Result: passed (exit 0, 11.6 s)

```text
(23 earlier lines omitted)
 + typing-inspection==0.4.4
 + yt-digest-node==0.1.0 (from file:///home/user/yt-digest-a1-r2.ariane/worktrees/17-replay-3/node)
 + yt-dlp==2026.8.19
============================= test session starts ==============================
platform linux -- Python 3.12.3, pytest-9.1.1, pluggy-1.7.0
rootdir: /home/user/yt-digest-a1-r2.ariane/worktrees/17-replay-3/node
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

============================= 127 passed in 10.42s =============================
```

## test-worker

- Command: `./scripts/check.sh test-worker`
- Blocking: yes
- Result: passed (exit 0, 9.7 s)

```text
(16 earlier lines omitted)


=======================================================================================
WARNING: @cloudflare/vitest-pool-workers has been renamed to @cloudflare/vitest-plugin.
This package will not receive future updates.
Run `npx @cloudflare/codemods vitest:pool-workers-to-vitest-plugin` to migrate.
=======================================================================================


[1m[30m[46m RUN [49m[39m[22m [36mv4.1.12 [39m[90m/home/user/yt-digest-a1-r2.ariane/worktrees/17-replay-4/worker[39m

 [32m✓[39m [30m[43m node [49m[39m tests/log.test.ts [2m([22m[2m5 tests[22m[2m)[22m[32m 9[2mms[22m[39m
 [32m✓[39m [30m[43m node [49m[39m tests/contracts.test.ts [2m([22m[2m39 tests[22m[2m)[22m[32m 41[2mms[22m[39m
 [32m✓[39m [30m[46m worker [49m[39m tests/worker/worker.test.ts [2m([22m[2m18 tests[22m[2m)[22m[32m 107[2mms[22m[39m

[2m Test Files [22m [1m[32m3 passed[39m[22m[90m (3)[39m
[2m      Tests [22m [1m[32m62 passed[39m[22m[90m (62)[39m
[2m   Start at [22m 06:05:30
[2m   Duration [22m 1.15s[2m (transform 194ms, setup 68ms, import 651ms, tests 157ms, environment 0ms)[22m
```

## e2e

- Command: `./scripts/check.sh e2e`
- Blocking: yes
- Result: passed (exit 0, 18.9 s)

```text
(47 earlier lines omitted)
added 198 packages, and audited 199 packages in 6s

63 packages are looking for funding
  run `npm fund` for details

5 high severity vulnerabilities

To address all issues (including breaking changes), run:
  npm audit fix --force

Run `npm audit` for details.
stack: ready http://127.0.0.1:8787

Running 3 tests using 1 worker

  ✓  1 [api] › tests/health.api.spec.ts:5:1 › the Worker answers /health (40ms)
  ✓  2 [api] › tests/health.api.spec.ts:11:1 › the mocks server answers /health (12ms)
  ✓  3 [api] › tests/health.api.spec.ts:17:1 › SponsorBlock has no segment for any video (14ms)

  3 passed (744ms)
```

Summary: 5 passed, 0 failed (0 blocking).
