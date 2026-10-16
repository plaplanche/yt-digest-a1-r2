# Checks

Replayed by Ariane on commit `75b803be18482c85080232a7bd02d8804a245bc1`.

| Check | Blocking | Result | Duration |
| --- | --- | --- | --- |
| lint | yes | pass | 7.1 s |
| contracts | yes | pass | 0.1 s |
| test-node | yes | pass | 1.3 s |
| test-worker | yes | pass | 2.9 s |

## lint

- Command: `./scripts/check.sh lint`
- Blocking: yes
- Result: passed (exit 0, 7.1 s)

```text
(20 earlier lines omitted)
 + pygments==2.21.0
 + pytest==9.1.1
 + ruff==0.17.1
 + typing-extensions==4.16.0
 + typing-inspection==0.4.4
 + yt-digest-node==0.1.0 (from file:///home/user/yt-digest-a1-r2.ariane/worktrees/3-replay/node)
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
All checks passed!
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
9 files already formatted
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
Success: no issues found in 9 source files

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
- Result: passed (exit 0, 1.3 s)

```text
== test-node
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
Resolved 18 packages in 1ms
Checked 17 packages in 0.26ms
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
============================= test session starts ==============================
platform linux -- Python 3.12.3, pytest-9.1.1, pluggy-1.7.0
rootdir: /home/user/yt-digest-a1-r2.ariane/worktrees/3-replay/node
configfile: pyproject.toml
collected 30 items

node/tests/test_contracts.py ......................                      [ 73%]
node/tests/test_log.py .......                                           [ 96%]
node/tests/test_placeholder.py .                                         [100%]

============================== 30 passed in 0.74s ==============================
```

## test-worker

- Command: `./scripts/check.sh test-worker`
- Blocking: yes
- Result: passed (exit 0, 2.9 s)

```text
== test-worker

added 135 packages, and audited 136 packages in 2s

43 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities

 RUN  v5.0.5 /home/user/yt-digest-a1-r2.ariane/worktrees/3-replay/worker


 Test Files  3 passed (3)
      Tests  15 passed (15)
   Start at  20:56:36
   Duration  313ms (import 49%, transform 41%, tests 6%, worker 4%)
```

Summary: 4 passed, 0 failed (0 blocking).
