// P7: the audit's /health ran `await pool().query("SELECT 1")` on the app pool, so a full pool
// answered 503. It now probes on a health pool of its own (server/http/health.ts, D17). The real
// mountHealth() is served from an express app on the real openDatabase() pools, and asked for
// /health/ready and /health/live while the app pool (max 10) is saturated:
//   held     all 10 clients are checked out and held (transactions waiting between statements)
//   busy     10 queries of pg_sleep(4) are running
//   backlog  60 queries of pg_sleep(1) are queued at once (6 s of work per slot)
import { directUrl, log } from "./proxy.ts";

const mode = process.argv[2] ?? "held";
process.env.DATABASE_URL = directUrl;
process.env.LOG_LEVEL = "silent";
if (!process.env.REDIS_URL) throw new Error("REDIS_URL is required: /health/ready also probes Redis");
const express = (await import("express")).default;
const { openDatabase, pool } = await import("../../../../../../server/store/db.ts");
const { mountHealth, markBooted } = await import("../../../../../../server/http/health.ts");
openDatabase();
const p = pool();
const app = express();
mountHealth(app);
markBooted();
const server = app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
const ask = async (path: string) => {
  const s = Date.now();
  const r = await fetch(`${base}${path}`);
  const body = await r.text();
  return `${r.status} after ${Date.now() - s}ms ${body.slice(0, 160)}`;
};
// The probes refresh each second, so a reading 1.5 s into a state describes that state.
const health = async () => {
  await new Promise((r) => setTimeout(r, 1_500));
  return `ready ${await ask("/health/ready")} | live ${await ask("/health/live")}`;
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
server.close();
process.exit(0);
