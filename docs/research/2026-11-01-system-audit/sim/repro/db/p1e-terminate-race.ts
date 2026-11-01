// P1 E: the production-shaped trigger. An idle pooled client's backend is terminated (a failover,
// an admin kill) and a transaction starts at once. Does pg-pool drop the dead idle client first,
// or does drizzle's BEGIN land on it and leak it? 20 trials on a fresh max-1 pool each.
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { directUrl } from "./proxy.ts";

const admin = new pg.Client({ connectionString: directUrl });
await admin.connect();
const out = { committed: 0, beginFailedLeaked: 0, beginFailedOther: 0 };
for (let i = 0; i < 20; i++) {
  const pool = new pg.Pool({ connectionString: directUrl, max: 1, connectionTimeoutMillis: 2_000 });
  pool.on("error", () => {});
  // As server/store/pool.ts does: a leaked, checked-out client has no pool listener left.
  pool.on("connect", (c) => c.on("error", () => {}));
  const pid = (await pool.query("select pg_backend_pid() pid")).rows[0].pid as number;
  const db = drizzle(pool);
  const kill = admin.query("select pg_terminate_backend($1)", [pid]);
  if (i % 2 === 1) await kill; // odd trials: wait for the kill to be acknowledged first
  try {
    await db.transaction(async (tx) => { await tx.execute(sql`select 1`); });
    out.committed++;
  } catch (e) {
    const failedBegin = String((e as Error).message).includes("begin");
    const leaked = pool.totalCount === 1 && pool.idleCount === 0;
    if (failedBegin && leaked) out.beginFailedLeaked++;
    else out.beginFailedOther++;
    console.log(`trial ${i}: ${(e as Error).message.split("\n")[0]} | total=${pool.totalCount} idle=${pool.idleCount}`);
  }
  await kill;
  await Promise.race([pool.end(), new Promise((r) => setTimeout(r, 200))]);
}
console.log("E result over 20 trials:", JSON.stringify(out));
await admin.end();
process.exit(0);
