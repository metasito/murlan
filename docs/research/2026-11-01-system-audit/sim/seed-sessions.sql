-- The 100k session rows (two per seeded user) that explain-baseline.txt's E11 ran against; seed.sql
-- does not write them. Run after seed.sql.
INSERT INTO session (sid, sess, expire)
SELECT 's' || i || '-' || k,
       json_build_object('cookie', json_build_object('originalMaxAge', 2592000000), 'userId', 'u' || i),
       now() + interval '30 days'
FROM generate_series(1, 50000) i, generate_series(1, 2) k;
ANALYZE session;
