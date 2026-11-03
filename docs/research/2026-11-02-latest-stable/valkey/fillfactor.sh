#!/usr/bin/env bash
# `active_games` at the default fillfactor against fillfactor=70: the move write
# (activeGameStore.write's upsert, one envelope rewritten per move) as a pgbench custom script,
# with a real envelope taken from a soak's table. Each setting runs RUNS times on a fresh table;
# reported: tps, and HOT updates over all updates from pg_stat_user_tables.
# Usage: PGPORT=55432 DB=<db holding a soaked active_games> bash fillfactor.sh
set -euo pipefail
port=${PGPORT:-55432}
db=${DB:?a database whose active_games a soak filled}
rows=${ROWS:-1000}
clients=${CLIENTS:-8}
seconds=${SECONDS_PER_RUN:-60}
runs=${RUNS:-3}
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
q() { psql -h localhost -p "$port" -U postgres -d "$db" -v ON_ERROR_STOP=1 -tAqc "$1"; }

# The largest envelope the soak left, so every write moves at least a real table's bytes.
q "select game_state::text from active_games order by length(game_state::text) desc limit 1" >"$work/envelope.json"
[ -s "$work/envelope.json" ] || { echo "fillfactor.sh: $db has no active_games row" >&2; exit 1; }
envelope=$(sed "s/'/''/g" "$work/envelope.json")
echo "envelope: $(wc -c <"$work/envelope.json") bytes of text"

# What activeGameStore.write sends, the epoch fence included; `moves` changes per write so no two
# envelopes are byte-identical.
cat >"$work/move.sql" <<SQL
\set room random(1, $rows)
\set move random(1, 1000000000)
INSERT INTO ff_games (room_id, game_state, updated_at, owner_epoch)
VALUES ('room-' || :room, jsonb_set('$envelope'::jsonb, '{moves}', to_jsonb(:move)), now(), 1)
ON CONFLICT (room_id) DO UPDATE
  SET game_state = jsonb_set(excluded.game_state, '{pendingResults}', coalesce(ff_games.game_state->'pendingResults', '[]'::jsonb)),
      updated_at = excluded.updated_at
  WHERE ff_games.owner_epoch = 1;
SQL

for setting in default 70; do
  for run in $(seq "$runs"); do
    q "drop table if exists ff_games"
    q "create table ff_games (like active_games including all)"
    [ "$setting" = default ] || q "alter table ff_games set (fillfactor=$setting)"
    q "insert into ff_games select 'room-' || g, jsonb_set('$envelope'::jsonb, '{moves}', to_jsonb(g)), now(), 1 from generate_series(1, $rows) g"
    q "vacuum analyze ff_games"
    q "select pg_stat_reset_single_table_counters('ff_games'::regclass)"
    tps=$(pgbench -h localhost -p "$port" -U postgres -n -c "$clients" -j "$clients" -T "$seconds" -f "$work/move.sql" "$db" 2>&1 \
      | sed -n 's/^tps = \([0-9.]*\).*/\1/p')
    sleep 2
    stats=$(q "select n_tup_upd, n_tup_hot_upd, round(n_tup_hot_upd::numeric / nullif(n_tup_upd, 0), 4),
      pg_relation_size('ff_games'), pg_total_relation_size('ff_games')
      from pg_stat_user_tables where relid = 'ff_games'::regclass")
    IFS='|' read -r upd hot ratio heap total <<<"$stats"
    echo "fillfactor=$setting run=$run tps=$tps updates=$upd hot=$hot hot_ratio=$ratio heap_bytes=$heap total_bytes=$total"
  done
done
q "drop table if exists ff_games"
