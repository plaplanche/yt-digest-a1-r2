#!/usr/bin/env bash
# Runs the worker tests.
set -euo pipefail
cd "$(dirname "$0")/../.."

cd worker
npm ci
npx vitest run
