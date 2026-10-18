#!/usr/bin/env bash
# Lint: Python (ruff, mypy), TypeScript (tsc, ESLint), shell (shellcheck).
set -euo pipefail
cd "$(dirname "$0")/../.."

uv sync --locked --project node
uv run --locked --project node ruff check node scripts/contracts_gen.py
uv run --locked --project node ruff format --check node scripts/contracts_gen.py
(cd node && uv run --locked mypy --strict src tests ../scripts/contracts_gen.py)

(cd worker && npm ci && npx tsc --noEmit && npx eslint .)
(cd e2e && npm ci && npx tsc --noEmit && npx eslint .)

find scripts -name '*.sh' -print0 | xargs -0 uvx --from shellcheck-py shellcheck
