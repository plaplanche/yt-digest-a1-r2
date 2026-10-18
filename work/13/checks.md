# Checks

Replayed by Ariane on commit `5e85674f03db09625987fec6b75898df484a74b1`.

Each check was replayed in its own clean working tree at `5e85674f03db09625987fec6b75898df484a74b1`, after the setup.

| Check | Blocking | Result | Duration |
| --- | --- | --- | --- |
| lint | yes | pass | 7.6 s |
| contracts | yes | pass | 0.1 s |
| test-node | yes | pass | 10.6 s |
| test-worker | yes | pass | 3.1 s |
| e2e | yes | pass | 0.0 s |

## lint

- Command: `./scripts/check.sh lint`
- Blocking: yes
- Result: passed (exit 0, 7.6 s)

```text
(16 earlier lines omitted)
 + pluggy==1.7.0
 + pydantic==2.14.1
 + pydantic-core==2.50.1
 + pygments==2.21.0
 + pytest==9.1.1
 + ruff==0.17.1
 + typing-extensions==4.16.0
 + typing-inspection==0.4.4
 + yt-digest-node==0.1.0 (from file:///home/user/yt-digest-a1-r2.ariane/worktrees/13-replay-1/node)
 + yt-dlp==2026.8.19
All checks passed!
28 files already formatted
Success: no issues found in 28 source files

added 135 packages, and audited 136 packages in 2s

43 packages are looking for funding
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
- Result: passed (exit 0, 10.6 s)

```text
(23 earlier lines omitted)
 + typing-inspection==0.4.4
 + yt-digest-node==0.1.0 (from file:///home/user/yt-digest-a1-r2.ariane/worktrees/13-replay-3/node)
 + yt-dlp==2026.8.19
============================= test session starts ==============================
platform linux -- Python 3.12.3, pytest-9.1.1, pluggy-1.7.0
rootdir: /home/user/yt-digest-a1-r2.ariane/worktrees/13-replay-3/node
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

============================= 127 passed in 9.42s ==============================
```

## test-worker

- Command: `./scripts/check.sh test-worker`
- Blocking: yes
- Result: passed (exit 0, 3.1 s)

```text
== test-worker

added 135 packages, and audited 136 packages in 2s

43 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities

[1m[30m[46m RUN [49m[39m[22m [36mv5.0.5 [39m[90m/home/user/yt-digest-a1-r2.ariane/worktrees/13-replay-4/worker[39m

 [32m✓[39m tests/placeholder.test.ts [2m([22m[2m1 test[22m[2m)[22m[32m 4[2mms[22m[39m
 [32m✓[39m tests/log.test.ts [2m([22m[2m5 tests[22m[2m)[22m[32m 7[2mms[22m[39m
 [32m✓[39m tests/contracts.test.ts [2m([22m[2m39 tests[22m[2m)[22m[32m 46[2mms[22m[39m

[2m Test Files [22m [1m[32m3 passed[39m[22m[90m (3)[39m
[2m      Tests [22m [1m[32m45 passed[39m[22m[90m (45)[39m
[2m   Start at [22m 05:47:10
[2m   Duration [22m 495ms[2m (import 57%, transform 30%, tests 11%, worker 2%)[22m
```

## e2e

- Command: `./scripts/check.sh e2e`
- Blocking: yes
- Result: passed (exit 0, 0.0 s)

```text
== e2e: not implemented yet, skipped
```

Summary: 5 passed, 0 failed (0 blocking).
