#!/usr/bin/env bash
# Runs the soak throughput mode at production pool sizes and reports database work per move,
# the pg_notify calls per move (read from the Postgres log) and the cluster messages per move.
# Usage: PGPORT=55432 REDIS_URL=redis://127.0.0.1:6379 [PGLOG=<postgres log file>] bash load.sh <tables> <minutes>
set -euo pipefail
tables=${1:-8}
minutes=${2:-1}
port=${PGPORT:-55432}
db=murlan_soak
root=$(cd "$(dirname "$0")/../../../.." && pwd)
: "${REDIS_URL:?REDIS_URL is required: the server will not boot without it}"
q() { psql -h localhost -p "$port" -U postgres -d "$db" -tAc "$1"; }

psql -h localhost -p "$port" -U postgres -tAc "select 1 from pg_database where datname='$db'" | grep -q 1 \
  || psql -h localhost -p "$port" -U postgres -tAc "create database $db" >/dev/null

# Every statement of this database goes to the log for the run, so pg_notify is counted, not assumed.
log=${PGLOG:-$(q "select coalesce(pg_current_logfile(), '')")}
case "$log" in /*) ;; ?*) log="$(q "show data_directory")/$log" ;; esac
if [ -z "$log" ] || [ ! -r "$log" ]; then
  echo "load.sh: cannot read the Postgres log (${log:-none}); set PGLOG to the server's log file" >&2
  exit 1
fi
psql -h localhost -p "$port" -U postgres -tAc "alter database $db set log_statement = 'all'" >/dev/null
trap 'psql -h localhost -p "$port" -U postgres -tAc "alter database $db reset log_statement" >/dev/null' EXIT
logged_from=$(($(stat -c %s "$log") + 1))
# A positive control: one pg_notify the count must see, so a zero below is a zero and not a blind grep.
q "select pg_notify('load_sh_control', '')" >/dev/null

stats="select xact_commit, tup_inserted, tup_updated, tup_deleted, tup_returned, tup_fetched from pg_stat_database where datname='$db'"
q "select pg_stat_reset()" >/dev/null
sleep 1
before=$(q "$stats")

out=$(cd "$root" && DATABASE_URL="postgres://postgres@localhost:$port/$db" REDIS_URL="$REDIS_URL" \
  MURLAN_PG_POOL_MAX=10 MURLAN_SOCKET_ADAPTER_POOL_MAX=4 MURLAN_AUTH_RATE_LIMIT=100000 MURLAN_TICKET_RATE_LIMIT=100000 LOG_LEVEL=warn \
  node --experimental-strip-types --no-warnings tests/soak/soak.ts --tables "$tables" --minutes "$minutes" --seed 4242 2>&1 | grep -E "^soak:" | tail -3 || true)
sleep 2
after=$(q "$stats")

echo "$out"
moves=$(echo "$out" | sed -n 's/.* \([0-9]*\) moves in .*/\1/p' | tail -1)
IFS='|' read -r c0 i0 u0 d0 r0 f0 <<<"$before"
IFS='|' read -r c1 i1 u1 d1 r1 f1 <<<"$after"
# The pg driver's parameterised queries log as "execute <name>:", simple queries as "statement:".
statements=$(tail -c +"$logged_from" "$log" | grep -cE "(statement|execute [^:]*): " || true)
notifies=$(tail -c +"$logged_from" "$log" | grep -ci "pg_notify" || true)
if [ "$notifies" -lt 1 ]; then
  echo "load.sh: the log does not show the control pg_notify, so pg_notify was not counted" >&2
  exit 1
fi
notifies=$((notifies - 1))
cluster=$(echo "$out" | sed -n 's/.*; \([0-9][0-9]*\) cluster messages.*/\1/p' | tail -1)
if [ -z "$cluster" ]; then
  echo "load.sh: the soak reported no cluster message count, so it was not counted" >&2
  exit 1
fi
# The soak's positive control: one inbox message sent before the play, which the count must see.
control=$(echo "$out" | sed -n 's/.* cluster messages, \([0-9][0-9]*\) of 1 control.*/\1/p' | tail -1)
if [ "${control:-0}" -lt 1 ]; then
  echo "load.sh: the cluster count did not see the soak's control message, so cluster messages were not counted" >&2
  exit 1
fi
echo "db: commits=$((c1 - c0)) inserted=$((i1 - i0)) updated=$((u1 - u0)) deleted=$((d1 - d0)) returned=$((r1 - r0)) fetched=$((f1 - f0)) moves=${moves:-?}"
echo "log: $statements statements, $notifies pg_notify; cluster: $cluster messages"
if [ "$statements" -eq 0 ]; then
  echo "load.sh: the log holds no statement of the run, so pg_notify was not counted" >&2
  exit 1
fi
if [ -n "${moves:-}" ] && [ "$moves" -gt 0 ]; then
  awk -v c=$((c1 - c0)) -v i=$((i1 - i0)) -v u=$((u1 - u0)) -v n="$notifies" -v x="$cluster" -v m="$moves" -v s="$statements" \
    'BEGIN { printf "per move: %.2f commits, %.2f inserts, %.2f updates, %.2f statements, %.2f pg_notify, %.2f cluster messages\n", c / m, i / m, u / m, s / m, n / m, x / m }'
fi
