#!/usr/bin/env bash
# fill.ts against each engine in turn, RUNS times, with bench.sh's server flags and pinning.
# Usage: REDIS_BIN=<dir> VALKEY_BIN=<dir> bash fill.sh <dump>...
set -euo pipefail
: "${REDIS_BIN:?}" "${VALKEY_BIN:?}"
port=${PORT:-46431}
runs=${RUNS:-3}
here=$(cd "$(dirname "$0")" && pwd)
dir=$(mktemp -d)
trap 'rm -rf "$dir"' EXIT
for server in "$REDIS_BIN/redis-server" "$VALKEY_BIN/valkey-server"; do
  taskset -c "${SERVER_CORES:-1}" "$server" --port "$port" --bind 127.0.0.1 --save "" --appendonly no \
    --maxmemory-policy noeviction --io-threads 1 --daemonize yes --dir "$dir" --logfile "$dir/server.log"
  for _ in $(seq 50); do "$VALKEY_BIN/valkey-cli" -p "$port" ping >/dev/null 2>&1 && break; sleep 0.1; done
  for _ in $(seq "$runs"); do REDIS_URL="redis://127.0.0.1:$port" node --no-warnings "$here/fill.ts" "$@"; done
  "$VALKEY_BIN/valkey-cli" -p "$port" shutdown nosave >/dev/null 2>&1 || true
  sleep 1
done
