# Review 1

- Reviewed commit: `8895c011458ec63e150188f46f978c8ff39fd8d9`
- Reviewer model: claude-opus-5-5
- Verdict: **go**

## Findings

- **minor** (`scripts/stack.sh:61`) Stack behaviours in the acceptance criteria are not tested or recorded

  Some acceptance criteria are not exercised by any automated check, and work/17/journal.md does not record a manual run of them either: `up` with a port already taken (exit 1, nothing left running), a second `down` exiting 0, the ports being free after `down`, and a second `up` starting from an empty D1 and R2. The e2e check only exercises the normal up → test → down path. Reading the code, these behaviours look correct: the port check (stack.sh:63-68) runs before any write, `down` without a pids file returns 0, and `rm -rf .stack/state` runs before the migrations. A recorded manual run, or a small script test, would show it.

- **minor** (`scripts/stack.sh:37`) `down` can signal an unrelated process group if PIDs were reused

  If `.stack/pids` is stale (for example after a reboot or a crashed `up`), `kill -TERM -- -<pid>` and then `kill -KILL` go to whatever process group now has that id. Checking that the group still belongs to wrangler or tsx before signalling it would make this safe. This is unlikely and does not break the acceptance criteria.

- **minor** (`scripts/stack.sh:100`) The readiness probe accepts any 2xx/3xx, not just 200

  `curl -fsS` succeeds on every status below 400, but spec 5.1 says both /health routes must 'answer 200'. Today both servers return 200, so nothing breaks. A strict check would be `-w '%{http_code}'` compared to 200.

- **minor** (`scripts/checks/e2e.sh:25`) The local Chromium probe does not install OS dependencies

  Outside CI, `playwright install chromium` can succeed on a host that lacks the system libraries. The browser project would then fail at launch instead of being skipped. This follows spec 3.1 exactly and no browser test exists yet, so it is only a note for later tickets.

- **minor** (`e2e/playwright.config.ts:7`) The serial run (`workers: 1`, `fullyParallel: false`) is not in docs/decisions.md

  Running the e2e tests serially against the shared stack is a reasonable open choice, but unlike the other choices of this ticket it is not written down in docs/decisions.md. The same goes for the html reporter.

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

  Layout matches spec section 2 (e2e/ package with Node 22, strict TS, Playwright config, tests/, mocks/server.ts run with tsx; scripts/stack.sh; scripts/checks/e2e.sh; .stack/ git-ignored). stack.sh follows 5.1 in order: down, then the port check, then npm ci when node_modules is missing, then rm .stack/state, then the logs are truncated, then the D1 migrations are applied with WRANGLER_SEND_METRICS=false and --persist-to .stack/state, then setsid starts mocks and wrangler dev on 127.0.0.1, then the readiness loop runs and prints 'stack: ready $WORKER_URL' last. Failures go to stderr and exit 1 after stopping what was started. `down` kills the process groups and exits 0 when nothing runs. All 5.2 variables and defaults are passed via --var (PUBLIC_URL=WORKER_URL); MOCKS_PORT, GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET go to the mocks. Mocks serve /health and the SponsorBlock 404 (5.3, Google routes deferred to ticket 07). e2e.sh follows 3.1: npm ci, then the CI/non-CI Chromium install with the exact skip message, then LEASE_SECONDS=2 up, then playwright test, then the stack is always stopped and artifacts are collected on failure. lint covers e2e/ (tsc + eslint), and ci/jobs.json gains the exact e2e job (3.2). The one extra change, removing `export const name` and its placeholder test, was needed for wrangler dev to start and is recorded in decisions.md.

- met: The change is covered by tests that fail without it.

  e2e/tests/health.api.spec.ts checks the Worker /health, the mocks /health and the SponsorBlock 404 through the stack. Without the mocks server, stack.sh or e2e.sh it cannot pass, and it passed in the replayed e2e check (18.9 s). The stack.sh edge cases (port taken, double down, empty state on a second up) are not tested automatically (see minor finding).

- met: Every choice the spec leaves open is written down in docs/decisions.md.

  Four dated lines were added: the removed `name` export; the pid-file and process-group stop strategy with its 10 s TERM-then-KILL timing, the TCP-connect port check and the early-exit detection; the project split by file name and the 404 for unknown mock routes; how 'Chromium unavailable' is decided and the WORKER_PORT/MOCKS_PORT env vars read by the tests. Only small choices are missing: the serial run and the html reporter (minor).

## Proposed learnings (not decided)

- For bash stack scripts, check that `$!` really is the process-group leader: `(cd x && exec setsid cmd) &` and `setsid cmd &` both keep the PID because a background job in a non-interactive shell is not a group leader, so setsid does not fork.
- `ps -g <numeric>` in procps selects by session id, which equals the PID after setsid. This is why it works for checking whether a whole stack group is still alive.
- Acceptance criteria about failure paths of shell tooling (port taken, idempotent down) are easy to leave unproven; ask for a recorded manual run or a small script test in the journal.
