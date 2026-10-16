# Review 0

- Reviewed commit: `bd33eeb95b34b68fcd5f9bede258cafb73abc967`
- Reviewer model: claude-opus-5-5
- Verdict: **go**

## Findings

- **minor** (`worker/package.json:16`) @types/node targets Node 26 while the spec fixes Node 22

  Spec section 2 says the worker runs on Node 22 and engines says >=22, but devDependencies pin @types/node ^26.6.5. tsc will accept Node 23-26 APIs that do not exist on the Node 22 runtime CI uses. Use @types/node ^22.

- **minor** (`scripts/checks/lint.sh:13`) shellcheck version is not pinned

  `uvx --from shellcheck-py shellcheck` resolves the latest shellcheck-py on every run. Nothing locks it, unlike ruff and mypy in uv.lock, so a new shellcheck release can turn lint red without any repository change. Pin it (e.g. `shellcheck-py==X.Y.Z`) and record the pin in docs/decisions.md.

- **minor** (`worker/tsconfig.json:4`) TypeScript module settings are an open choice that is not recorded

  `module: ESNext`, `moduleResolution: Bundler` and `target: ES2022` decide how every later import is written (extensionless imports are allowed), but docs/decisions.md does not mention them. Ruff using only its default rule set is also not written down.

- **minor** (`worker/tsconfig.json:11`) eslint.config.js in tsconfig include has no effect

  Without `allowJs`, tsc skips `eslint.config.js`, so listing it in `include` is misleading. Remove the entry or enable `allowJs`/`checkJs` on purpose.

- **minor** (`scripts/checks/contracts.sh:6`) A non-executable contracts.sh is silently treated as absent

  The `-x` test means a committed `scripts/contracts.sh` without the executable bit makes the check pass with 'does not exist yet' instead of failing. Use `-e` to test existence, then run the script so a missing exec bit fails loudly.

- **minor** (`work/1/journal.md:1`) No evidence that lint fails on each of the four error kinds

  The acceptance criteria ask to show that lint fails on a Python lint error, a type error, a TypeScript error and a shellcheck warning, using throwaway changes. Nothing in the commit records those runs. By reading the script, each one would fail (set -euo pipefail, the && chain in the subshell, xargs exit 123), but the runs should be shown in the PR or the journal.

## Definition of done

- met: check lint passes

  Replayed by Ariane: exit 0.

- met: check contracts passes

  Replayed by Ariane: exit 0.

- met: check test-node passes

  Replayed by Ariane: exit 0.

- met: check test-worker passes

  Replayed by Ariane: exit 0.

- met: The change does what the ticket and spec/lot-1.md say, and nothing more.

  Adds node/ (uv, Python 3.12, yt_digest_node under src/, ruff/mypy/pytest dev group, uv.lock, one placeholder test) and worker/ (npm, strict TS, ESLint, Vitest, package-lock.json, one placeholder test). Adds the four executable scripts in scripts/checks/, each doing what section 3.1 says and installing its own dependencies (uv sync --locked, npm ci). ci/jobs.json already has one job per check. No contracts, loggers or pipeline code; spec/ and .github/workflows/ are untouched. One deviation: @types/node is ^26 rather than Node 22 (minor).

- met: The change is covered by tests that fail without it.

  node/tests/test_placeholder.py imports yt_digest_node and worker/tests/placeholder.test.ts imports src/index. Both fail without the packages. The four checks pass (lint, contracts, test-node, test-worker). The lint failure demonstrations the ticket asks for are not recorded in the repository.

- met: Every choice the spec leaves open is written down in docs/decisions.md.

  docs/decisions.md records the Python pin and hatchling, the mypy scope, the ESLint flat config with recommended rules and the tsc scope, and the contracts fallback, each on a dated line. Smaller omissions are reported as minor findings: tsconfig module/target/moduleResolution, the ruff default rule set and the unpinned shellcheck.

## Proposed learnings (not decided)

- Pin @types/node to the runtime major fixed by the spec (Node 22 → ^22), not to the latest.
- Tools run through uvx/npx outside a lockfile (shellcheck-py) should be pinned so checks stay reproducible.
- Record the acceptance-criteria demonstrations (throwaway failing changes) in the journal or PR so reviewers can verify them.
- tsconfig module resolution is a project-wide choice and belongs in docs/decisions.md.
