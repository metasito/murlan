#!/usr/bin/env bash
# Our store patterns, Redis 7.4.12 against Valkey 9.1.3, on one machine: each engine is started on
# its own with the same flags and pinned to the same core, and one client binary (valkey-benchmark
# 9.1.3) drives both from other cores. Every case runs RUNS times; summarize.mjs takes the median.
# Usage: REDIS_BIN=<dir> VALKEY_BIN=<dir> PAYLOAD=<file> SMALL_PAYLOAD=<file> OUT=<dir> bash bench.sh
# Each payload file holds one inbox `m` value with no trailing newline: PAYLOAD a state delivery of
# the measured median size, SMALL_PAYLOAD a table-ask of its median size (valkey-measured.md).
set -euo pipefail
: "${REDIS_BIN:?}" "${VALKEY_BIN:?}" "${PAYLOAD:?}" "${SMALL_PAYLOAD:?}" "${OUT:?}"
port=${PORT:-46431}
server_cores=${SERVER_CORES:-1}
client_cores=${CLIENT_CORES:-2,3}
runs=${RUNS:-3}
n=${REQUESTS:-200000}
clients=${CLIENTS:-50}
threads=${CLIENT_THREADS:-2}
bench="$VALKEY_BIN/valkey-benchmark"
cli="$VALKEY_BIN/valkey-cli"
mkdir -p "$OUT"

# The old Lua from git history (e9e6f5ca7^:server/store/tableOwners.ts) and rate-limit-redis's
# increment script with our decrement (server/http/rateLimit.ts).
CLEAR_IF_MINE="if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0"
REFRESH_IF_MINE="local v = redis.call('GET', KEYS[1]) if v == false then return redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2]) end if v == ARGV[1] then return redis.call('PEXPIRE', KEYS[1], ARGV[2]) end return 0"
LIMIT_INCREMENT=$(printf '%s\n' 'local windowMs = tonumber(ARGV[1])' 'local timeToExpire = redis.call("PTTL", KEYS[1])' 'if timeToExpire <= 0 then' 'redis.call("SET", KEYS[1], 1, "PX", windowMs)' 'return { 1, windowMs }' 'end' 'local totalHits = redis.call("INCR", KEYS[1])' 'return { totalHits, timeToExpire }')
LIMIT_DECREMENT=$(printf '%s\n' 'local hits = tonumber(redis.call("GET", KEYS[1]))' 'if hits and hits > 0 and redis.call("PTTL", KEYS[1]) > 0 then return redis.call("DECR", KEYS[1]) end' 'return 0')

owner=0f3c2b1e-6a4d-4c1e-9b7a-2d5e8f1a3c4b:7
c() { "$cli" -p "$port" "$@"; }
b() { taskset -c "$client_cores" "$bench" -p "$port" -c "$clients" --threads "$threads" --csv "$@"; }

start() {
  local bin=$1
  taskset -c "$server_cores" "$bin" --port "$port" --bind 127.0.0.1 --save "" --appendonly no \
    --maxmemory-policy noeviction --io-threads 1 --daemonize no --dir "$OUT" >"$OUT/server.log" 2>&1 &
  for _ in $(seq 50); do c ping >/dev/null 2>&1 && return; sleep 0.1; done
  echo "bench.sh: $bin never answered on $port" >&2
  exit 1
}

stop() {
  c shutdown nosave >/dev/null 2>&1 || true
  wait 2>/dev/null || true
}

# One case: $1 engine, $2 name, $3 a setup function run before every run, then the benchmark args;
# `-x` reads the last argument from $stdin (PAYLOAD unless a case sets it).
stdin=$PAYLOAD
case_() {
  local engine=$1 name=$2 setup=$3
  shift 3
  for run in $(seq "$runs"); do
    c flushall >/dev/null
    $setup
    printf '%s,%s,%s,' "$engine" "$name" "$run" >>"$OUT/raw.csv"
    b "$@" <"$stdin" | tail -n 1 >>"$OUT/raw.csv"
  done
  echo "$engine $name: taskset -c $client_cores valkey-benchmark -p $port -c $clients --threads $threads --csv $* <$(basename "$stdin")" >>"$OUT/commands.txt"
}

none() { :; }
inbox() { c xadd inbox NOMKSTREAM MAXLEN '~' 120000 '*' m boot >/dev/null; c xadd inbox MAXLEN '~' 120000 '*' m boot >/dev/null; }
inbox_full() {
  inbox
  taskset -c "$client_cores" "$bench" -p "$port" -c 50 -n 120000 -x xadd inbox MAXLEN '~' 120000 '*' m <"$PAYLOAD" >/dev/null
}
owners() { taskset -c "$client_cores" "$bench" -p "$port" -c 50 -n 10000 -r 10000 --sequential -q set "owner:__rand_int__" "$owner" >/dev/null; }
owners_all() { taskset -c "$client_cores" "$bench" -p "$port" -c 50 -n "$n" -r "$n" --sequential -q set "owner:__rand_int__" "$owner" >/dev/null; }

: >"$OUT/raw.csv"
: >"$OUT/commands.txt"
for engine in redis-7.4.12 valkey-9.1.3; do
  case $engine in
    redis-*) start "$REDIS_BIN/redis-server" ;;
    valkey-*) start "$VALKEY_BIN/valkey-server" ;;
  esac
  c info server | grep -E '^(redis_version|valkey_version|server_name)' >>"$OUT/engines.txt"
  sha_clear=$(c script load "$CLEAR_IF_MINE")
  sha_refresh=$(c script load "$REFRESH_IF_MINE")
  sha_incr=$(c script load "$LIMIT_INCREMENT")
  sha_decr=$(c script load "$LIMIT_DECREMENT")

  case_ "$engine" "xadd-nomkstream-maxlen" inbox -n "$n" -x xadd inbox NOMKSTREAM MAXLEN '~' 120000 '*' m
  stdin=$SMALL_PAYLOAD
  case_ "$engine" "xadd-nomkstream-maxlen-small" inbox -n "$n" -x xadd inbox NOMKSTREAM MAXLEN '~' 120000 '*' m
  stdin=$PAYLOAD
  case_ "$engine" "xadd-nomkstream-maxlen-at-cap" inbox_full -n "$n" -x xadd inbox NOMKSTREAM MAXLEN '~' 120000 '*' m
  case_ "$engine" "xread-count100" inbox_full -n "$n" xread COUNT 100 STREAMS inbox 0-0
  case_ "$engine" "xread-count1" inbox_full -n "$n" xread COUNT 1 STREAMS inbox 0-0
  case_ "$engine" "refresh-lua" owners -n "$n" -r 10000 evalsha "$sha_refresh" 1 "owner:__rand_int__" "$owner" 30000
  case_ "$engine" "clear-lua" owners_all -n "$n" -r "$n" --sequential evalsha "$sha_clear" 1 "owner:__rand_int__" "$owner"
  case_ "$engine" "limit-increment-lua" none -n "$n" -r 10000 evalsha "$sha_incr" 1 "limit:__rand_int__" 60000
  case_ "$engine" "limit-decrement-lua" none -n "$n" -r 10000 evalsha "$sha_decr" 1 "limit:__rand_int__"
  if [ "${engine%%-*}" = valkey ]; then
    case_ "$engine" "refresh-set-ifeq" owners -n "$n" -r 10000 set "owner:__rand_int__" "$owner" PX 30000 IFEQ "$owner"
    case_ "$engine" "clear-delifeq" owners_all -n "$n" -r "$n" --sequential delifeq "owner:__rand_int__" "$owner"
  fi
  stop
done
