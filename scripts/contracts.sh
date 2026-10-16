#!/usr/bin/env bash
# Generates the TypeScript types and Pydantic models from contracts/*.schema.json.
# With --check, regenerates into a temporary directory and exits 1 naming the stale files.
set -euo pipefail
cd "$(dirname "$0")/.."

exec uv run --no-project python scripts/contracts_gen.py "$@"
