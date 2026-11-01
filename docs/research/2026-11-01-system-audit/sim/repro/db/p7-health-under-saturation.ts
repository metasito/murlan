// P7: /health's probe is `await pool().query("SELECT 1")` on the app pool (server/app.ts:235-250);
// a rejection answers 503. Run that exact call on the real openDatabase() pool (max 10) while:
//   held     all 10 clients are checked out and held (transactions waiting between statements)
//   busy     10 queries of pg_sleep(4) are running
//   backlog  60 queries of pg_sleep(1) are queued at once (6 s of work per slot)
import { log } from "./proxy.ts";
import { directUrl } from "./proxy.ts";

const mode = process.argv[2] ?? "held";
process.env.DATABASE_URL = directUrl;
process.env.LOG_LEVEL = "silent";
const { openDatabase, pool } = await import("../../../../../../server/store/db.ts");
openDatabase();
const p = pool();
const health = async () => {
  const s = Date.now();
  try {
    await pool().query("SELECT 1");
    return `200 after ${Date.now() - s}ms`;
  } catch (e) {
    return `503 after ${Date.now() - s}ms (${(e as Error).message})`;
  }
};
log(`idle pool: health ${await health()}`);

if (mode === "held") {
  const held = await Promise.all(Array.from({ length: 10 }, () => p.connect()));
  log(`checked out ${held.length}: total=${p.totalCount} idle=${p.idleCount}`);
  log(`health: ${await health()}`);
  // The clients are healthy: each answers at once when asked directly.
  const s = Date.now();
  await Promise.all(held.map((c) => c.query("select 1")));
  log(`the 10 held clients each answer a query in ${Date.now() - s}ms total`);
  held.forEach((c) => c.release());
}

if (mode === "busy") {
  const work = Array.from({ length: 10 }, () => p.query("select pg_sleep(4)"));
  await new Promise((r) => setTimeout(r, 200));
  log(`10 x pg_sleep(4) running: total=${p.totalCount} idle=${p.idleCount}`);
  log(`health: ${await health()}`);
  await Promise.allSettled(work);
}

if (mode === "backlog") {
  const s = Date.now();
  const work = Array.from({ length: 60 }, () =>
    p.query("select pg_sleep(1)").then(() => "ok", (e: Error) => e.message));
  await new Promise((r) => setTimeout(r, 100));
  log(`60 x pg_sleep(1) submitted: total=${p.totalCount} waiting=${p.waitingCount}`);
  log(`health: ${await health()}`);
  const results = await Promise.all(work);
  const tally: Record<string, number> = {};
  for (const r of results) tally[r] = (tally[r] ?? 0) + 1;
  log(`the 60 app queries after ${Date.now() - s}ms: ${JSON.stringify(tally)}`);
}
await p.end();
