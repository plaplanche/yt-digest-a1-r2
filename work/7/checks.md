# Checks

Replayed by Ariane on commit `5e946d8672d56c9f1beb73fbe8f0bdb30d98ee20`.

| Check | Blocking | Result | Duration |
| --- | --- | --- | --- |
| lint | yes | pass | 8.4 s |
| contracts | yes | pass | 0.1 s |
| test-node | yes | pass | 5.1 s |
| test-worker | yes | pass | 4.2 s |

## lint

- Command: `./scripts/check.sh lint`
- Blocking: yes
- Result: passed (exit 0, 8.4 s)

```text
(20 earlier lines omitted)
 + pygments==2.21.0
 + pytest==9.1.1
 + ruff==0.17.1
 + typing-extensions==4.16.0
 + typing-inspection==0.4.4
 + yt-digest-node==0.1.0 (from file:///home/user/yt-digest-a1-r2.ariane/worktrees/7-replay/node)
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
All checks passed!
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
13 files already formatted
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
Success: no issues found in 13 source files

added 135 packages, and audited 136 packages in 2s

43 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
```

## contracts

- Command: `./scripts/check.sh contracts`
- Blocking: yes
- Result: passed (exit 0, 0.1 s)

```text
== contracts
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
```

## test-node

- Command: `./scripts/check.sh test-node`
- Blocking: yes
- Result: passed (exit 0, 5.1 s)

```text
== test-node
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
Resolved 18 packages in 2ms
Checked 17 packages in 0.67ms
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
============================= test session starts ==============================
platform linux -- Python 3.12.3, pytest-9.1.1, pluggy-1.7.0
rootdir: /home/user/yt-digest-a1-r2.ariane/worktrees/7-replay/node
configfile: pyproject.toml
collected 58 items

node/tests/test_contracts.py ......................                      [ 37%]
node/tests/test_log.py .......                                           [ 50%]
node/tests/test_placeholder.py .                                         [ 51%]
node/tests/test_sponsorblock.py ..............                           [ 75%]
node/tests/test_vtt.py ..............                                    [100%]

============================== 58 passed in 4.46s ==============================
```

## test-worker

- Command: `./scripts/check.sh test-worker`
- Blocking: yes
- Result: passed (exit 0, 4.2 s)

```text
== test-worker

added 135 packages, and audited 136 packages in 3s

43 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities

 RUN  v5.0.5 /home/user/yt-digest-a1-r2.ariane/worktrees/7-replay/worker


 Test Files  3 passed (3)
      Tests  15 passed (15)
   Start at  21:06:43
   Duration  398ms (import 55%, transform 35%, tests 6%, worker 4%)
```

Summary: 4 passed, 0 failed (0 blocking).
