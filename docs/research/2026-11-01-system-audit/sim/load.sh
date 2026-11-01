#!/usr/bin/env bash
# Runs the soak throughput mode at production pool sizes and reports database work per move.
# Usage: PGPORT=55432 bash load.sh <tables> <minutes>
set -euo pipefail
tables=${1:-8}
minutes=${2:-1}
port=${PGPORT:-55432}
db=murlan_soak
root=$(cd "$(dirname "$0")/../../../.." && pwd)
q() { psql -h localhost -p "$port" -U postgres -d "$db" -tAc "$1"; }

psql -h localhost -p "$port" -U postgres -tAc "select 1 from pg_database where datname='$db'" | grep -q 1 \
  || psql -h localhost -p "$port" -U postgres -tAc "create database $db" >/dev/null

stats="select xact_commit, tup_inserted, tup_updated, tup_deleted, tup_returned, tup_fetched from pg_stat_database where datname='$db'"
q "select pg_stat_reset()" >/dev/null
sleep 1
before=$(q "$stats")

out=$(cd "$root" && DATABASE_URL="postgres://postgres@localhost:$port/$db" \
  MURLAN_PG_POOL_MAX=10 MURLAN_SOCKET_ADAPTER_POOL_MAX=4 MURLAN_AUTH_RATE_LIMIT=100000 MURLAN_TICKET_RATE_LIMIT=100000 LOG_LEVEL=warn \
  node --experimental-strip-types --no-warnings tests/soak/soak.ts --tables "$tables" --minutes "$minutes" --seed 4242 2>&1 | grep -E "^soak:" | tail -3)
sleep 2
after=$(q "$stats")

echo "$out"
moves=$(echo "$out" | sed -n 's/.* \([0-9]*\) moves in .*/\1/p' | tail -1)
IFS='|' read -r c0 i0 u0 d0 r0 f0 <<<"$before"
IFS='|' read -r c1 i1 u1 d1 r1 f1 <<<"$after"
echo "db: commits=$((c1 - c0)) inserted=$((i1 - i0)) updated=$((u1 - u0)) deleted=$((d1 - d0)) returned=$((r1 - r0)) fetched=$((f1 - f0)) moves=${moves:-?}"
if [ -n "${moves:-}" ] && [ "$moves" -gt 0 ]; then
  awk -v c=$((c1 - c0)) -v i=$((i1 - i0)) -v u=$((u1 - u0)) -v m="$moves" \
    'BEGIN { printf "per move: %.2f commits, %.2f inserts, %.2f updates\n", c / m, i / m, u / m }'
fi
