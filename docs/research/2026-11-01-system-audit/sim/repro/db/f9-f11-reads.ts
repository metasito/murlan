// Finding 9: the SQL friendStore.getFriends / getPendingFriendRequests send, and the columns that
// come back. Finding 11: the SQL activeGameStore.list() (the orphan sweep's read) sends, and the
// bytes it moves for 1,000 envelopes of ~3 kB. Both through the real stores on the real pool,
// with pool.query wrapped to capture the statement text.
import pg from "pg";
import { directUrl, log } from "./proxy.ts";

process.env.DATABASE_URL = directUrl;
process.env.LOG_LEVEL = "silent";
const { openDatabase, pool } = await import("../../../../../../server/store/db.ts");
const { friendStore } = await import("../../../../../../server/store/friendStore.ts");
const { activeGameStore } = await import("../../../../../../server/store/activeGameStore.ts");
openDatabase();
const p = pool();
const captured: string[] = [];
const orig = p.query.bind(p) as (...a: unknown[]) => Promise<unknown>;
(p as unknown as { query: (...a: unknown[]) => Promise<unknown> }).query = (...a: unknown[]) => {
  const q = a[0] as string | { text: string };
  captured.push(typeof q === "string" ? q : q.text);
  return orig(...a);
};
const admin = new pg.Client({ connectionString: directUrl });
await admin.connect();
await admin.query(`TRUNCATE friends, active_games, users CASCADE`);
await admin.query(`INSERT INTO users (id, username, password, friend_code, email) VALUES
  ('u1','alice','$2b$10$abcdefghijklmnopqrstuvC0ffeeHashOfAlicePassword012345','AAAAAA','alice@example.com'),
  ('u2','bob','$2b$10$abcdefghijklmnopqrstuvC0ffeeHashOfBobPassword0123456789','BBBBBB','bob@example.com'),
  ('u3','carol','$2b$10$abcdefghijklmnopqrstuvC0ffeeHashOfCarolPassword01234567','CCCCCC','carol@example.com')`);
await admin.query(`INSERT INTO friends (user_id, friend_user_id, status) VALUES ('u1','u2','accepted'), ('u3','u1','pending')`);

// ---- Finding 9
captured.length = 0;
const fr = await friendStore.getFriends("u1");
log(`getFriends SQL: ${captured.join(" ;; ")}`);
log(`getFriends row.friend keys: ${Object.keys(fr[0]!.friend).join(", ")}`);
log(`getFriends row.friend carries password: ${"password" in fr[0]!.friend}, email: ${"email" in fr[0]!.friend}`);
captured.length = 0;
const pend = await friendStore.getPendingFriendRequests("u1");
log(`getPendingFriendRequests SQL: ${captured.join(" ;; ")}`);
log(`getPendingFriendRequests row.requester keys: ${Object.keys(pend[0]!.requester).join(", ")}`);

// ---- Finding 11
const N = 1000;
const card = (i: number) => ({ id: `c${i}-${(i * 7919) % 1000}`, suit: ["hearts", "spades", "clubs", "diamonds"][i % 4], rank: (i % 13) + 2 });
const envelope = (r: number) => ({
  schemaVersion: 10, joinCode: `J${String(r).padStart(5, "0")}`, dealFirstSeat: r % 4,
  roundFlags: { 0: { bomb: false, joker: r % 2 === 0 } },
  gameState: {
    hands: [0, 1, 2, 3].map((s) => Array.from({ length: 13 }, (_, k) => card(r + s * 13 + k))),
    currentPlayer: r % 4, passCount: 0, roundOver: false, playedRanks: [3, 4, 5],
    lastPlayedCombination: { type: "pair", cards: [card(r), card(r + 1)] }, turnStartedAt: 1793560000000 + r,
  },
  match: { playerMap: { 0: `user-${r}-a`, 1: `user-${r}-b`, 2: `user-${r}-c`, 3: `user-${r}-d` }, scores: { 0: r % 50, 1: 3, 2: 7, 3: 11 },
    gameMode: "classic", matchLength: "short", matchTarget: 21, maxPlayers: 4, roundsPlayed: 2, endedByVote: false, matchOver: false },
  seats: { bots: [], vacated: [], away: [], kicked: [] },
});
await admin.query(`INSERT INTO active_games (room_id, game_state) SELECT 'room-' || g, x::jsonb FROM
  unnest($1::text[]) WITH ORDINALITY t(x, g)`, [Array.from({ length: N }, (_, r) => JSON.stringify(envelope(r)))]);
const sizes = (await admin.query(`select count(*)::int n, round(avg(octet_length(game_state::text)))::int avg_text,
  sum(octet_length(game_state::text))::int text_bytes, sum(pg_column_size(game_state))::int stored_bytes,
  pg_size_pretty(pg_total_relation_size('active_games')) table_size from active_games`)).rows[0];
log(`active_games: ${JSON.stringify(sizes)}`);
captured.length = 0;
const t = Date.now();
const rows = await activeGameStore.listResumable();
const ms = Date.now() - t;
log(`activeGameStore.listResumable() SQL: ${captured.join(" ;; ")}`);
log(`returned ${rows.length} rows in ${ms}ms; JSON of the result ${Buffer.byteLength(JSON.stringify(rows))} bytes in the Node heap`);
const plan = (await admin.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) select "room_id", "game_state" from "active_games"`)).rows.map((r) => r["QUERY PLAN"]);
log(`plan: ${plan.join(" | ")}`);
await admin.query(`TRUNCATE friends, active_games, users CASCADE`);
await admin.end();
await p.end();
