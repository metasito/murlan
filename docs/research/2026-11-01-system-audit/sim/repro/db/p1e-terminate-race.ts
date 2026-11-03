// P1 E: the production-shaped trigger. An idle pooled client's backend is terminated (a failover,
// an admin kill) and a transaction starts at once. Does pg-pool drop the dead idle client first,
// or does the BEGIN land on it and leak it? 20 trials on a fresh max-1 pool each, through the
// server's own transaction wrapper (server/store/pool.ts inTransaction), which replaced drizzle's.
// `drizzle` as the argument runs drizzle's own transaction() instead: the positive control.
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { directUrl } from "./proxy.ts";
const viaDrizzle = process.argv[2] === "drizzle";
const { inTransaction } = await import("../../../../../../server/store/pool.ts");

const admin = new pg.Client({ connectionString: directUrl });
await admin.connect();
const out = { committed: 0, failed: 0, leaked: 0 };
for (let i = 0; i < 20; i++) {
  const pool = new pg.Pool({ connectionString: directUrl, max: 1, connectionTimeoutMillis: 2_000 });
  pool.on("error", () => {});
  // As server/store/pool.ts does: a leaked, checked-out client has no pool listener left.
  pool.on("connect", (c) => c.on("error", () => {}));
  const pid = (await pool.query("select pg_backend_pid() pid")).rows[0].pid as number;
  const kill = admin.query("select pg_terminate_backend($1)", [pid]);
  if (i % 2 === 1) await kill; // odd trials: wait for the kill to be acknowledged first
  try {
    if (viaDrizzle) await drizzle(pool).transaction(async (tx) => { await tx.execute(sql`select 1`); });
    else await inTransaction(pool, async (client) => { await client.query("select 1"); });
    out.committed++;
  } catch (e) {
    out.failed++;
    // Leaked: the pool still counts a client nobody holds, so a max-1 pool cannot serve the next query.
    const next = await pool.query("select 1").then(() => "next query ok", (err: Error) => `next query: ${err.message}`);
    if (next !== "next query ok") out.leaked++;
    console.log(`trial ${i}: ${(e as Error).message.split("\n")[0]} | total=${pool.totalCount} idle=${pool.idleCount} | ${next}`);
  }
  await kill;
  await Promise.race([pool.end(), new Promise((r) => setTimeout(r, 200))]);
}
console.log(`E result over 20 trials (${viaDrizzle ? "drizzle's transaction(), the control" : "the server's inTransaction"}):`, JSON.stringify(out));
await admin.end();
process.exit(0);
