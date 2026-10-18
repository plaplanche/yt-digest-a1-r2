# Review 0

- Reviewed commit: `e8d637d439bcc2494abb34cf85b32af414d223d3`
- Reviewer model: claude-opus-5-5
- Verdict: **no-go** (the reviewer answered no-go)

## Findings

- **blocking** (`scripts/checks/e2e.sh:23`) Artifacts are not collected when the stack fails to start

  Spec 3.1 says: "On failure it copies `.stack/logs/` and the Playwright report into `ci-artifacts/`". Here `collect` runs only in the `||` branch of `npx playwright test`. Under `set -e`, a failing `LEASE_SECONDS=2 ./scripts/stack.sh up` (line 23) exits straight away. The EXIT trap runs `stack.sh down` and nothing else, so `ci-artifacts/` is never written. That is the failure where `worker.log` and `mocks.log` are most needed (wrangler not starting, readiness timeout, port taken). The same gap applies to `npm ci` and `playwright install` failing in CI. Fix: in the EXIT trap, run `collect` when the exit status is non-zero, then `stack.sh down`.

- **minor** (`scripts/stack.sh:101`) Readiness probes have no per-request timeout

  `curl -fsS` has no `--max-time`. If a listener accepts the connection but never answers, a single probe can block past `STACK_READY_TIMEOUT`, and `up` hangs instead of failing with exit 1 as spec 5.1 requires. Adding `--max-time 2` keeps the deadline check meaningful.

- **minor** (`scripts/checks/e2e.sh:24`) Empty array expansion under `set -u`

  When `projects` is empty, `"${projects[@]}"` is an unbound-variable error on bash older than 4.4 (for example macOS's default 3.2). Ubuntu CI is not affected. `${projects[@]+"${projects[@]}"}` works on every version.

- **minor** (`e2e/playwright.config.ts:12`) Unused `metadata.mocksUrl`

  The config defines `metadata.mocksUrl`, but the test builds its own `mocksUrl` from `MOCKS_PORT` (`e2e/tests/health.api.spec.ts:3`). That leaves two sources of truth, one of them dead. Keep one.

- **minor** (`scripts/stack.sh:1`) stack.sh acceptance behaviours are not covered by an automated test

  These behaviours were checked by hand at most: port taken gives exit 1 with nothing left running, a second `down` exits 0, ports are free after `down`, and a second `up` starts from empty state. Nothing in `check.sh` would catch a regression in them. This is acceptable for a harness ticket, but worth noting.

- **blocking** Definition of done not met: The change does what the ticket and spec/lot-2.md (and spec/lot-1.md, which still applies) say, and nothing more.

  Most of the ticket matches the spec: layout (section 2), stack.sh up/down order and the `--var` config (5.1, 5.2), the mocks `/health` and SponsorBlock 404 (5.3), lint extended to `e2e/`, the `e2e` CI job (3.2) and `.stack/` git-ignored. One deviation from 3.1: e2e.sh does not copy the logs to `ci-artifacts/` when `stack.sh up` fails. Removing `export const name` is outside the ticket's text, but it was needed for `wrangler dev` and is recorded in `docs/decisions.md`.

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

- **not met**: The change does what the ticket and spec/lot-2.md (and spec/lot-1.md, which still applies) say, and nothing more.

  Most of the ticket matches the spec: layout (section 2), stack.sh up/down order and the `--var` config (5.1, 5.2), the mocks `/health` and SponsorBlock 404 (5.3), lint extended to `e2e/`, the `e2e` CI job (3.2) and `.stack/` git-ignored. One deviation from 3.1: e2e.sh does not copy the logs to `ci-artifacts/` when `stack.sh up` fails. Removing `export const name` is outside the ticket's text, but it was needed for `wrangler dev` and is recorded in `docs/decisions.md`.

- met: The change is covered by tests that fail without it.

  `e2e/tests/health.api.spec.ts` checks the Worker's `/health`, the mocks server's `/health` and the SponsorBlock 404. All three fail without the stack and the mocks server. The e2e check passed in Ariane's replay. The stack.sh edge cases (port taken, double `down`) have no automated test.

- met: Every choice the spec leaves open is written down in docs/decisions.md.

  Four dated lines cover the open choices: PID and process-group handling and the TERM/KILL timing; how a taken port is detected; failing early when a process exits; telling Playwright projects apart by file name; the mocks server's 404 for unknown routes; how e2e.sh decides Chromium is unavailable; ports read from `WORKER_PORT`/`MOCKS_PORT`; and removing the `name` export.

## Proposed learnings (not decided)

- When a spec says 'on failure, collect artifacts', put the collection in the EXIT trap and run it on any non-zero status, not in a `||` after one command; with `set -e`, earlier steps exit without reaching it.
- Readiness loops built on curl need `--max-time`, or the overall timeout can be bypassed by a listener that accepts connections but never answers.
- `setsid cmd &` in a non-interactive script runs setsid in place (the job is not a group leader), so `$!` is both the session id and the process-group id; that is what makes `kill -- -$pid` and `ps -g` work.
