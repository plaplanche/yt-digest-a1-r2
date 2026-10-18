#!/usr/bin/env bash
# Local stack: the Worker (wrangler dev) and the mocks server. Usage: ./scripts/stack.sh <up|down>
set -euo pipefail
cd "$(dirname "$0")/.."

WORKER_PORT="${WORKER_PORT:-8787}"
MOCKS_PORT="${MOCKS_PORT:-8789}"
STACK_READY_TIMEOUT="${STACK_READY_TIMEOUT:-180}"
WORKER_URL="http://127.0.0.1:$WORKER_PORT"
MOCKS_URL="http://127.0.0.1:$MOCKS_PORT"
OPS_TOKEN="${OPS_TOKEN:-ops-local}"
LEASE_SECONDS="${LEASE_SECONDS:-600}"
ACCESS_TOKEN_TTL_SECONDS="${ACCESS_TOKEN_TTL_SECONDS:-3600}"
REFRESH_TOKEN_TTL_SECONDS="${REFRESH_TOKEN_TTL_SECONDS:-2592000}"
AUTH_CODE_TTL_SECONDS="${AUTH_CODE_TTL_SECONDS:-60}"
AUTH_REQUEST_TTL_SECONDS="${AUTH_REQUEST_TTL_SECONDS:-600}"
GOOGLE_ISSUER="${GOOGLE_ISSUER:-$MOCKS_URL/google}"
GOOGLE_CLIENT_ID="${GOOGLE_CLIENT_ID:-yt-digest-local}"
GOOGLE_CLIENT_SECRET="${GOOGLE_CLIENT_SECRET:-local-google-secret}"
ADMIN_EMAIL="${ADMIN_EMAIL:-alice@test}"
TOKEN_ENC_KEY="${TOKEN_ENC_KEY:-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=}"
ALLOWED_ORIGINS="${ALLOWED_ORIGINS:-}"

STATE=.stack/state
LOGS=.stack/logs
PIDS=.stack/pids

port_taken() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }

# A process group is alive while one of its members is not a zombie (setsid makes the session id the group id).
# shellcheck disable=SC2009 # pgrep cannot tell zombies apart
group_alive() { ps -o stat= -g "$1" 2>/dev/null | grep -qv '^Z'; }

down() {
  local pid
  if [[ -f "$PIDS" ]]; then
    while read -r pid; do
      [[ -n "$pid" ]] && kill -TERM -- "-$pid" 2>/dev/null || true
    done <"$PIDS"
    for _ in $(seq 1 50); do
      local alive=0
      while read -r pid; do
        [[ -n "$pid" ]] && group_alive "$pid" && alive=1
      done <"$PIDS"
      [[ $alive -eq 0 ]] && break
      sleep 0.2
    done
    while read -r pid; do
      [[ -n "$pid" ]] && kill -KILL -- "-$pid" 2>/dev/null || true
    done <"$PIDS"
    rm -f "$PIDS"
  fi
}

fail() {
  echo "stack: $1" >&2
  down
  exit 1
}

up() {
  down
  for port in "$WORKER_PORT" "$MOCKS_PORT"; do
    if port_taken "$port"; then
      echo "stack: port $port is already taken" >&2
      exit 1
    fi
  done

  [[ -d worker/node_modules ]] || (cd worker && npm ci)
  [[ -d e2e/node_modules ]] || (cd e2e && npm ci)

  rm -rf "$STATE"
  mkdir -p "$STATE" "$LOGS"
  : >"$LOGS/worker.log"
  : >"$LOGS/mocks.log"
  export WRANGLER_SEND_METRICS=false

  (cd worker && npx wrangler d1 migrations apply DB --local --persist-to ../"$STATE") >>"$LOGS/worker.log" 2>&1 ||
    fail "applying the D1 migrations failed (see $LOGS/worker.log)"

  : >"$PIDS"
  MOCKS_PORT="$MOCKS_PORT" GOOGLE_CLIENT_ID="$GOOGLE_CLIENT_ID" GOOGLE_CLIENT_SECRET="$GOOGLE_CLIENT_SECRET" \
    setsid bash -c 'cd e2e && exec npx tsx mocks/server.ts' >>"$LOGS/mocks.log" 2>&1 </dev/null &
  echo $! >>"$PIDS"

  local vars=(
    PUBLIC_URL="$WORKER_URL" OPS_TOKEN="$OPS_TOKEN" LEASE_SECONDS="$LEASE_SECONDS"
    ACCESS_TOKEN_TTL_SECONDS="$ACCESS_TOKEN_TTL_SECONDS" REFRESH_TOKEN_TTL_SECONDS="$REFRESH_TOKEN_TTL_SECONDS"
    AUTH_CODE_TTL_SECONDS="$AUTH_CODE_TTL_SECONDS" AUTH_REQUEST_TTL_SECONDS="$AUTH_REQUEST_TTL_SECONDS"
    GOOGLE_ISSUER="$GOOGLE_ISSUER" GOOGLE_CLIENT_ID="$GOOGLE_CLIENT_ID" GOOGLE_CLIENT_SECRET="$GOOGLE_CLIENT_SECRET"
    ADMIN_EMAIL="$ADMIN_EMAIL" TOKEN_ENC_KEY="$TOKEN_ENC_KEY" ALLOWED_ORIGINS="$ALLOWED_ORIGINS"
  )
  local args=(--local --ip 127.0.0.1 --port "$WORKER_PORT" --persist-to ../"$STATE")
  local v
  for v in "${vars[@]}"; do args+=(--var "${v/=/:}"); done
  (cd worker && exec setsid npx wrangler dev "${args[@]}") >>"$LOGS/worker.log" 2>&1 </dev/null &
  echo $! >>"$PIDS"

  local pid deadline=$((SECONDS + STACK_READY_TIMEOUT))
  until curl -fsS -o /dev/null "$WORKER_URL/health" 2>/dev/null && curl -fsS -o /dev/null "$MOCKS_URL/health" 2>/dev/null; do
    while read -r pid; do
      kill -0 "$pid" 2>/dev/null || fail "a process exited early (see $LOGS)"
    done <"$PIDS"
    ((SECONDS < deadline)) || fail "not ready after ${STACK_READY_TIMEOUT}s (see $LOGS)"
    sleep 0.5
  done
  echo "stack: ready $WORKER_URL"
}

case "${1:-}" in
  up) up ;;
  down) down ;;
  *) echo "usage: $0 <up|down>" >&2; exit 2 ;;
esac
