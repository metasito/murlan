// P3c: ensureSchema runs on the app pool, so every DDL statement carries statement_timeout and
// query_timeout of 5 s (server/store/db.ts). Two ways a missing index can take longer than that:
//   lock  an open write transaction on the table (CREATE INDEX needs SHARE, which waits for it)
//   big   the table holds <rows> rows, so the build itself runs past 5 s
// Usage: p3c-ddl-under-statement-timeout.ts lock | big <rows>
import pg from "pg";
import { directUrl, log } from "./proxy.ts";

const mode = process.argv[2] ?? "lock";
process.env.DATABASE_URL = directUrl;
process.env.LOG_LEVEL = "silent";
const { createPool } = await import("../../../../../../server/store/pool.ts");
const { ensureSchema } = await import("../../../../../../server/store/schemaDdl.ts");
const appPoolConfig = { max: 10, connectionTimeoutMillis: 5_000, idleTimeoutMillis: 30_000, statement_timeout: 5_000, query_timeout: 5_000 };

const other = new pg.Client({ connectionString: directUrl });
await other.connect();
await other.query(`DROP INDEX IF EXISTS "IDX_session_expire"`);

if (mode === "lock") {
  await other.query("BEGIN");
  await other.query(`INSERT INTO "session" (sid, sess, expire) VALUES ('held', '{}', now())`);
  log("another session holds an open write transaction on \"session\"; IDX_session_expire dropped");
} else {
  const rows = Number(process.argv[3] ?? 2_000_000);
  await other.query(`TRUNCATE "session"`);
  await other.query(
    `INSERT INTO "session" (sid, sess, expire)
     SELECT md5(g::text), '{"cookie":{}}'::json, now() + (random() * interval '30 days') FROM generate_series(1, $1) g`, [rows]);
  await other.query(`ANALYZE "session"`);
  const size = (await other.query(`select pg_size_pretty(pg_total_relation_size('session')) s`)).rows[0].s;
  const t = Date.now();
  await other.query(`CREATE INDEX "probe_session_expire" ON "session" ("expire")`);
  log(`session: ${rows} rows, ${size}; the same index built with no timeout in ${Date.now() - t}ms`);
  await other.query(`DROP INDEX "probe_session_expire"`);
}

const pool = createPool("boot", appPoolConfig);
const t = Date.now();
try {
  await ensureSchema(pool);
  log(`ensureSchema: ok after ${Date.now() - t}ms`);
} catch (e) {
  const err = e as { code?: string; message: string };
  log(`ensureSchema: FAILED after ${Date.now() - t}ms: ${err.code ?? ""} ${err.message.split("\n")[0]}`);
}
if (mode === "lock") await other.query("ROLLBACK");
const idx = await other.query(`select indexname from pg_indexes where indexname='IDX_session_expire'`);
log(`IDX_session_expire present afterwards: ${idx.rowCount === 1}`);
await other.query(`TRUNCATE "session"`);
await pool.end();
await other.end();
