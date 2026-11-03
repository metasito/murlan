// P1: the audit drove drizzle's transaction(); every server transaction now goes through
// server/store/db.ts transaction() (D11, tests/server/transactionScan.test.ts), so that is what runs
// here, on the app's real openDatabase() pool (max 2, MURLAN_PG_POOL_MAX).
//   A  BEGIN rejects on a healthy client (the wrapper's BEGIN takes no config, so the client's
//      query is made to reject on BEGIN: the code path, not the trigger, as the audit's was).
//   B  BEGIN times out on a half-open client (proxy blackholes the pooled sockets).
//   C  BEGIN succeeds, the connection goes half-open mid-transaction: is the client released with
//      or without the error, and does it come back to the pool idle?
//   D  BEGIN succeeds, the backend is terminated mid-transaction: does pg-pool keep the client?
// Usage: node --experimental-strip-types --no-warnings p1-drizzle-transaction-leak.ts A|B|C|D
import pg from "pg";
import { sql } from "drizzle-orm";
import { startProxy, viaProxy, directUrl, PG_PORT, log } from "./proxy.ts";

const scenario = process.argv[2] ?? "A";
const proxy = await startProxy(PG_PORT);
process.env.DATABASE_URL = viaProxy(proxy.port);
process.env.MURLAN_PG_POOL_MAX = "2";
const { openDatabase, transaction, pool } = await import("../../../../../../server/store/db.ts");
const db = () => ({ transaction });
openDatabase();
const p = pool();
const stats = (label: string) =>
  log(`${label}: total=${p.totalCount} idle=${p.idleCount} waiting=${p.waitingCount}`);
const timed = async (label: string, f: () => Promise<unknown>) => {
  const s = Date.now();
  try {
    await f();
    log(`${label}: ok after ${Date.now() - s}ms`);
  } catch (e) {
    log(`${label}: REJECTED after ${Date.now() - s}ms: ${(e as Error).message.split("\n")[0]} ${(e as { cause?: Error }).cause ? "| cause: " + (e as { cause: Error }).cause.message : ""}`);
  }
};
let releases = 0;
p.on("release", (err) => { releases++; log(`pool 'release' event #${releases}, err passed: ${err ? (err as Error).message : "none"}`); });
p.on("remove", () => log("pool 'remove' event (client discarded)"));

// Warm two clients so the pool is at max and both are idle (C2: one, so only it goes half-open).
if (scenario === "C2") await p.query("select 1");
else await Promise.all([p.query("select pg_sleep(0.1)"), p.query("select pg_sleep(0.1)")]);
stats("warm");

// C2: the half-open client C returns to the pool is next checked out by a transaction, not a
// pool.query: its BEGIN queues behind the timed-out rollback and fails, and B's leak follows.
if (scenario === "C2") {
  await timed("transaction #1, connection goes half-open after BEGIN", () =>
    db().transaction(async (tx) => {
      await tx.execute(sql`select 1`);
      log(`blackholed ${proxy.blackholeExisting()} connection`);
      await tx.execute(sql`select 2`);
    }));
  stats("after #1 (the half-open client is back, idle)");
  await timed("transaction #2 checks it out", () =>
    db().transaction(async (tx) => { await tx.execute(sql`select 1`); }));
  stats("after #2");
  log("waiting 35 s (past idleTimeoutMillis 30 s)");
  await new Promise((r) => setTimeout(r, 35_000));
  stats("after 35 s");
  await timed("a plain query (a second, healthy client can still be opened)", () => p.query("select 1"));
  stats("after plain query");
}

if (scenario === "A") {
  const connect = p.connect.bind(p) as () => Promise<pg.PoolClient>;
  (p as unknown as { connect: () => Promise<pg.PoolClient> }).connect = async () => {
    const client = await connect();
    const query = client.query.bind(client) as (text: string) => Promise<unknown>;
    (client as unknown as { query: (text: unknown) => Promise<unknown> }).query = (text: unknown) =>
      text === "BEGIN" ? query("begin isolation level bogus level") : query(text as string);
    return client;
  };
  for (const i of [1, 2]) {
    await timed(`transaction #${i} with BEGIN that fails`, () =>
      db().transaction(async (tx) => { await tx.execute(sql`select 1`); }));
    stats(`after #${i}`);
  }
  (p as unknown as { connect: typeof connect }).connect = connect;
  await timed("a plain query afterwards (pool.query)", () => p.query("select 1"));
  stats("after plain query");
  const direct = new pg.Client({ connectionString: directUrl });
  await direct.connect();
  const { rows } = await direct.query(
    "select pid, state, backend_xid, left(query,40) q from pg_stat_activity where datname='murlan_repro_db' and pid<>pg_backend_pid()");
  log("server side, the database's backends afterwards:", JSON.stringify(rows));
  await direct.end();
}

if (scenario === "B") {
  log(`blackholed ${proxy.blackholeExisting()} pooled connections (half-open)`);
  for (const i of [1, 2]) {
    await timed(`transaction #${i} (BEGIN on a half-open client)`, () =>
      db().transaction(async (tx) => { await tx.execute(sql`select 1`); }));
    stats(`after #${i}`);
  }
  await timed("a plain query, new connections forward fine", () => p.query("select 1"));
  stats("after plain query");
  log("waiting 35 s (past idleTimeoutMillis 30 s) to see whether anything reclaims the slots");
  await new Promise((r) => setTimeout(r, 35_000));
  stats("after 35 s");
  await timed("a plain query after 35 s", () => p.query("select 1"));
}

if (scenario === "C") {
  await timed("transaction whose connection goes half-open after BEGIN", () =>
    db().transaction(async (tx) => {
      await tx.execute(sql`select 1`);
      log(`blackholed ${proxy.blackholeExisting()} connections`);
      await tx.execute(sql`select 2`);
    }));
  stats("after the transaction");
  log("the next plain queries land on whatever idle client the pool hands out:");
  await timed("plain query #1", () => p.query("select 1"));
  stats("after #1");
  await timed("plain query #2", () => p.query("select 1"));
  stats("after #2");
}

if (scenario === "D") {
  const direct = new pg.Client({ connectionString: directUrl });
  await direct.connect();
  await timed("transaction whose backend is terminated after BEGIN", () =>
    db().transaction(async (tx) => {
      const r = await tx.execute(sql`select pg_backend_pid() as pid`);
      const pid = (r.rows[0] as { pid: number }).pid;
      await direct.query("select pg_terminate_backend($1)", [pid]);
      log(`terminated backend ${pid}`);
      await new Promise((res) => setTimeout(res, 200));
      await tx.execute(sql`select 2`);
    }));
  stats("after the transaction");
  await timed("plain query", () => p.query("select 1"));
  stats("after plain query");
  await direct.end();
}

await proxy.close();
process.exit(0);
