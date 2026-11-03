// P8: what each pool actually sets, read from a live session of each and from the pg client
// config each was built with. App and admin pools: real openDatabase(); health: the real "health"
// profile of createPool; ownership: the real gameOwnership client (via claimRoom). The audit's
// adapter pool is gone (the cluster runs over Redis), so the Redis connection options are printed
// in its place, from the real redisOptions().
import pg from "pg";
import { directUrl } from "./proxy.ts";

process.env.DATABASE_URL = directUrl;
process.env.LOG_LEVEL = "silent";
const { openDatabase, pool, adminPool } = await import("../../../../../../server/store/db.ts");
const { createPool } = await import("../../../../../../server/store/pool.ts");
const { redisOptions } = await import("../../../../../../server/store/redis.ts");
const own = await import("../../../../../../server/game/gameOwnership.ts");
openDatabase();
const { activeGameStore } = await import("../../../../../../server/store/activeGameStore.ts");
own.reopenOwnership({ onRoomLost: () => {}, rows: activeGameStore });

const probe = `select pg_backend_pid() pid,
  current_setting('application_name') application_name,
  current_setting('idle_in_transaction_session_timeout') idle_in_tx_timeout,
  current_setting('statement_timeout') statement_timeout,
  current_setting('lock_timeout') lock_timeout,
  current_setting('tcp_keepalives_idle') ka_idle,
  current_setting('tcp_keepalives_interval') ka_interval,
  current_setting('tcp_keepalives_count') ka_count`;
const clientCfg = (c: pg.PoolClient | pg.Client) => {
  // pg keeps these on the Connection (node_modules/pg/lib/connection.js:24-25), not the Client.
  const x = c as unknown as { connectionParameters: { application_name?: string }; connection: { _keepAlive?: boolean; _keepAliveInitialDelayMillis?: number } };
  return { keepAlive: x.connection._keepAlive ?? false, keepAliveInitialDelayMillis: x.connection._keepAliveInitialDelayMillis ?? 0, application_name: x.connectionParameters.application_name ?? null };
};
const show = async (name: string, p: pg.Pool) => {
  const c = await p.connect();
  const row = (await c.query(probe)).rows[0];
  const o = p.options as pg.PoolOptions & { maxLifetimeSeconds?: number };
  console.log(`${name}: session ${JSON.stringify(row)}`);
  console.log(`${name}: client ${JSON.stringify(clientCfg(c))} pool {max:${o.max}, idleTimeoutMillis:${o.idleTimeoutMillis}, maxLifetimeSeconds:${o.maxLifetimeSeconds ?? 0}}`);
  c.release();
};
await show("app pool", pool());
await show("admin pool", adminPool());
const healthPool = createPool("health");
await show("health pool", healthPool);
await healthPool.end();
for (const use of ["adapter", "inbox"] as const) {
  const o = redisOptions(use, "redis://127.0.0.1:6379");
  console.log(`redis ${use}: ${JSON.stringify({ name: o.name, pingInterval: o.pingInterval, keepAlive: o.socket.keepAlive, keepAliveInitialDelay: o.socket.keepAliveInitialDelay, socketTimeout: o.socket.socketTimeout, commandTimeout: o.commandOptions.timeout })}`);
}
const control = new pg.Pool({ connectionString: directUrl, max: 1, keepAlive: true, keepAliveInitialDelayMillis: 10_000, application_name: "control", maxLifetimeSeconds: 1800 } as pg.PoolConfig);
await show("positive control (keepAlive, application_name, lifetime set)", control);
await control.end();

await own.claimRoom("p8-room");
const admin = new pg.Client({ connectionString: directUrl });
await admin.connect();
const ownRow = (await admin.query(
  `select a.pid, a.application_name from pg_locks l join pg_stat_activity a using (pid) where l.locktype='advisory' and a.datname='murlan_repro_db'`)).rows[0];
console.log(`ownership client: pg_stat_activity ${JSON.stringify(ownRow)} (its SETs are per session and the client is not exported, so they are not readable from here)`);
const all = (await admin.query(
  `select pid, coalesce(nullif(application_name,''),'<empty>') application_name, state from pg_stat_activity where datname='murlan_repro_db' and pid<>pg_backend_pid() order by pid`)).rows;
console.log(`every app session in pg_stat_activity: ${JSON.stringify(all)}`);
const sys = (await admin.query(
  `select name, setting, source from pg_settings where name in ('idle_in_transaction_session_timeout','tcp_keepalives_idle','tcp_keepalives_interval','tcp_keepalives_count','idle_session_timeout')`)).rows;
console.log(`server defaults: ${JSON.stringify(sys)}`);
await admin.end();
process.exit(0);
