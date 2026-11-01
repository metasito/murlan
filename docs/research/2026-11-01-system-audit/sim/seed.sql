-- Launch-scale seed for query plans: 50k users, 2M round_history, 2M events, 200k replays.
-- Ids are deterministic ('u1'..'u50000', 'r1'..) so EXPLAIN literals can name real rows.
\set users 50000
\set rooms 100000
\set history 2000000
\set events 2000000
\set replays 200000

BEGIN;

INSERT INTO users (id, username, password, friend_code, created_at, last_seen, email, email_verified_at)
SELECT 'u' || i, 'player' || i, 'x', lpad(to_hex(i), 6, '0'),
       now() - (i % 365) * interval '1 day', now() - (i % 30) * interval '1 hour',
       'p' || i || '@example.test', CASE WHEN i % 3 = 0 THEN now() END
FROM generate_series(1, :users) i;

INSERT INTO user_stats (user_id, rounds_played, rounds_won, matches_won, current_streak, best_streak, bombs_played)
SELECT 'u' || i, i % 500, i % 120, i % 30, i % 5, i % 12, i % 40 FROM generate_series(1, :users) i;

INSERT INTO user_ratings (user_id, season, rating, rounds)
SELECT 'u' || i, s.season, 1000 + ((i * 7919) % 1200), i % 300
FROM generate_series(1, :users) i, (VALUES ('2026-10'), ('2026-11')) s(season);

-- About eight friendships per user, both directions, as accepting writes them.
INSERT INTO friends (id, user_id, friend_user_id, status, created_at)
SELECT 'f' || i || '-' || k || '-' || d,
       CASE d WHEN 0 THEN 'u' || i ELSE 'u' || (1 + (i + k * 977) % :users) END,
       CASE d WHEN 0 THEN 'u' || (1 + (i + k * 977) % :users) ELSE 'u' || i END,
       CASE WHEN k = 4 THEN 'pending'::friend_status ELSE 'accepted'::friend_status END,
       now() - k * interval '1 day'
FROM generate_series(1, :users) i, generate_series(1, 4) k, generate_series(0, 1) d
WHERE NOT (k = 4 AND d = 1)
ON CONFLICT DO NOTHING;

INSERT INTO rooms (id, code, host_user_id, status, game_mode, max_players, visibility, auto_start, created_at)
SELECT 'r' || i, upper(lpad(to_hex(i + 1000000), 6, '0')), 'u' || (1 + i % :users),
       (CASE WHEN i > :rooms - 300 THEN 'waiting' WHEN i > :rooms - 800 THEN 'in_progress' ELSE 'finished' END)::room_status,
       (CASE WHEN i % 5 = 0 THEN 'teams' ELSE 'free_for_all' END)::game_mode_type,
       CASE WHEN i % 5 = 0 THEN 4 ELSE 2 + i % 3 END,
       (CASE WHEN i % 2 = 0 THEN 'public' ELSE 'private' END)::room_visibility,
       i % 2 = 0, now() - ((:rooms - i) % 90) * interval '1 day'
FROM generate_series(1, :rooms) i;

INSERT INTO room_players (id, room_id, user_id, seat_index, team)
SELECT 'rp' || i || '-' || s, 'r' || i, 'u' || (1 + (i * 4 + s) % :users), s, NULL
FROM generate_series(1, :rooms) i, generate_series(0, 3) s;

-- Skewed: a few heavy players hold most rows, as real ladders do.
INSERT INTO round_history (id, user_id, finished_at, game_mode, placement, player_count, points, opponents, rating_delta, abandoned)
SELECT 'h' || i, 'u' || (1 + floor(:users * power(random(), 3))::int % :users),
       now() - (i % 200000) * interval '1 minute', CASE WHEN i % 5 = 0 THEN 'teams' ELSE 'free_for_all' END,
       1 + i % 4, 4, 3 - i % 4, jsonb_build_array('u1', 'u2', 'u3'),
       CASE WHEN i % 5 = 0 THEN NULL ELSE (i % 31) - 15 END, i % 97 = 0
FROM generate_series(1, :history) i;

INSERT INTO events (id, user_id, occurred_at, name, context)
SELECT 'e' || i, 'u' || (1 + i % :users), now() - (i % 500000) * interval '1 minute',
       (ARRAY['lobby.entered', 'room.joined', 'game.firstMoveMade', 'socket.closed', 'game.abandoned'])[1 + i % 5],
       '{}'::jsonb
FROM generate_series(1, :events) i;

INSERT INTO round_replays (id, room_id, finished_at, game_mode, player_ids, seats, moves, opening, finishing_order)
SELECT 'rr' || i, 'r' || (1 + i % :rooms), now() - (i % 100000) * interval '2 minute', 'free_for_all',
       jsonb_build_array('u' || (1 + i % :users), 'u' || (1 + (i + 1) % :users), 'u' || (1 + (i + 2) % :users), 'u' || (1 + (i + 3) % :users)),
       '[]'::jsonb, (SELECT jsonb_agg(jsonb_build_object('seat', m % 4, 'cards', jsonb_build_array(m))) FROM generate_series(1, 60) m),
       NULL, jsonb_build_array('player_0', 'player_1', 'player_2', 'player_3')
FROM generate_series(1, :replays) i;

INSERT INTO user_achievements (user_id, achievement_id)
SELECT 'u' || i, a FROM generate_series(1, :users) i, unnest(ARRAY['first_win', 'bomber', 'streak_3']) a WHERE i % 2 = 0;

COMMIT;
ANALYZE;
