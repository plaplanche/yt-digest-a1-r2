#!/usr/bin/env bash
# Runs the end-to-end tests against the local stack.
set -euo pipefail
cd "$(dirname "$0")/../.."

collect() {
  mkdir -p ci-artifacts
  cp -r .stack/logs ci-artifacts/ 2>/dev/null || true
  cp -r e2e/playwright-report ci-artifacts/ 2>/dev/null || true
}

finish() {
  local status=$?
  trap - EXIT
  ((status == 0)) || collect
  ./scripts/stack.sh down || true
  exit "$status"
}
trap finish EXIT

(cd e2e && npm ci)

projects=()
if [[ -n "${CI:-}" ]]; then
  (cd e2e && npx playwright install --with-deps chromium)
elif ! (cd e2e && timeout 120 npx playwright install chromium); then
  echo "e2e: chromium unavailable, browser project skipped"
  projects=(--project=api)
fi

LEASE_SECONDS=2 ./scripts/stack.sh up
(cd e2e && npx playwright test ${projects[@]+"${projects[@]}"})
