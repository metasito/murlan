-- Query plans for the audit's hot and risky queries, on the seed in seed.sql.
-- The production statement_timeout is 5s (server/store/db.ts); a case that hits it prints the error.
\timing on
SET statement_timeout = '5s';

\echo '== E1 replays list, user in few replays (listReplaysForUser)'
EXPLAIN (ANALYZE, BUFFERS) SELECT id, finished_at, game_mode, seats, jsonb_array_length(moves) FROM round_replays
WHERE player_ids @> '["u777"]'::jsonb ORDER BY finished_at DESC LIMIT 20;

\echo '== E2 replays list, user in no replay'
EXPLAIN (ANALYZE, BUFFERS) SELECT id, finished_at, game_mode, seats, jsonb_array_length(moves) FROM round_replays
WHERE player_ids @> '["u-none"]'::jsonb ORDER BY finished_at DESC LIMIT 20;

\echo '== E3 account delete: replays by player or vacated seat'
EXPLAIN (ANALYZE, BUFFERS) SELECT id, player_ids, seats FROM round_replays
WHERE player_ids @> '["u777"]'::jsonb OR seats @> '[{"vacatedBy":"u777"}]'::jsonb;

\echo '== E4 account delete: cascade into events, round_history (FK triggers)'
BEGIN;
DELETE FROM friends WHERE user_id = 'u777' OR friend_user_id = 'u777';
DELETE FROM room_players WHERE user_id = 'u777';
UPDATE rooms SET host_user_id = NULL WHERE host_user_id = 'u777';
EXPLAIN (ANALYZE, BUFFERS) DELETE FROM users WHERE id = 'u777';
ROLLBACK;

\echo '== E5 round_history prune after each recorded round (heavy user)'
BEGIN;
EXPLAIN (ANALYZE, BUFFERS) DELETE FROM round_history WHERE user_id = 'u1' AND id NOT IN
  (SELECT id FROM round_history WHERE user_id = 'u1' ORDER BY finished_at DESC, id DESC LIMIT 50);
ROLLBACK;

\echo '== E6 admin: active players over 7 days'
EXPLAIN (ANALYZE, BUFFERS) SELECT count(DISTINCT user_id) FROM round_history WHERE finished_at >= now() - interval '7 days';

\echo '== E7 admin funnel over 30 days of events'
EXPLAIN (ANALYZE, BUFFERS) SELECT name, count(*), count(DISTINCT user_id) FROM events
WHERE occurred_at >= now() - interval '30 days' GROUP BY name ORDER BY 2 DESC;

\echo '== E8 quick match candidate rooms'
EXPLAIN (ANALYZE, BUFFERS) SELECT r.*, count(rp.id), coalesce(bool_or(rp.user_id = 'u1'), false) FROM rooms r
LEFT JOIN room_players rp ON rp.room_id = r.id WHERE r.visibility = 'public' AND r.status = 'waiting'
GROUP BY r.id ORDER BY r.created_at;

\echo '== E9 global leaderboard'
EXPLAIN (ANALYZE, BUFFERS) SELECT ur.user_id, u.username, ur.rating, ur.rounds FROM user_ratings ur JOIN users u ON u.id = ur.user_id
WHERE ur.season = '2026-11' AND ur.rounds >= 10 ORDER BY ur.rating DESC, ur.updated_at LIMIT 50;

\echo '== E10 profile history (heavy user)'
EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM round_history WHERE user_id = 'u1' ORDER BY finished_at DESC LIMIT 50;

\echo '== E11 session rows of one user (password change, account delete)'
EXPLAIN (ANALYZE, BUFFERS) SELECT sid FROM session WHERE sess->>'userId' = 'u777';
