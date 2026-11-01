// P4: the real server/game/gameOwnership.ts through the proxy.
//   reclaim  claim 3 rooms, then make the ownership connection half-open while Postgres keeps its
//            backend (and the locks) alive. Wait for the 15 s heartbeat + 5 s query timeout and
//            watch onRoomLost (in production: disposeGame(rt, roomId, false), tableRuntime.ts:94).
//   connect  new connections are accepted but never answered: does claimRoom ever settle?
// Usage: p4-ownership-self-conflict.ts reclaim | connect
import pg from "pg";
import { startProxy, viaProxy, directUrl, PG_PORT, log } from "./proxy.ts";

//   reclaim-fin  as reclaim, but the app's close of the old connection still reaches Postgres
const mode = process.argv[2] ?? "reclaim";
const proxy = await startProxy(PG_PORT, { finThroughDead: mode === "reclaim-fin" });
process.env.DATABASE_URL = viaProxy(proxy.port);
const own = await import("../../../../../../server/game/gameOwnership.ts");
const lost: string[] = [];
own.reopenOwnership({ onRoomLost: (roomId) => { lost.push(roomId); log(`onRoomLost(${roomId}) -> production disposes this table`); } });
const admin = new pg.Client({ connectionString: directUrl });
await admin.connect();
const locks = async () =>
  (await admin.query(
    `select l.pid, a.state, count(*)::int n from pg_locks l join pg_stat_activity a using (pid)
     where l.locktype='advisory' and a.datname='murlan_repro_db' group by 1,2 order by 1`)).rows;
const backends = async () =>
  (await admin.query(`select pid, state, left(query,50) q from pg_stat_activity where datname='murlan_repro_db' and pid<>pg_backend_pid() order by backend_start`)).rows;

if (mode === "reclaim" || mode === "reclaim-fin") {
  const rooms = ["room-a", "room-b", "room-c"];
  for (const r of rooms) log(`claimRoom(${r}) = ${await own.claimRoom(r)}`);
  log("advisory locks:", JSON.stringify(await locks()));
  log(`made ${proxy.blackholeExisting()} connection(s) half-open; Postgres still sees its backend alive`);
  await new Promise((r) => setTimeout(r, 24_000));
  log("backends now:", JSON.stringify(await backends()));
  log("advisory locks now:", JSON.stringify(await locks()));
  log(`ownsRoom: ${rooms.map((r) => `${r}=${own.ownsRoom(r)}`).join(" ")}; onRoomLost called for ${lost.length}/3`);
  log("can this process claim room-a again on its new connection?", await own.claimRoom("room-a"));
  await new Promise((r) => setTimeout(r, 5_000));
  log(`after 5 s more, onRoomLost total ${lost.length} (no retry for "elsewhere")`);
}

if (mode === "connect") {
  proxy.blackholeNew(true);
  const started = Date.now();
  const settled: string[] = [];
  for (const r of ["room-x", "room-y"])
    void own.claimRoom(r).then((v) => settled.push(`${r}=${v} after ${Date.now() - started}ms`));
  for (const s of [5, 15, 30]) {
    await new Promise((r) => setTimeout(r, (s - (Date.now() - started) / 1000) * 1000));
    log(`${s} s: claimRoom settled: ${settled.length ? settled.join(", ") : "none, both still pending"}`);
  }
  log(`proxy saw ${proxy.links.length} connection attempt(s) (one shared connect: every claim waits on it)`);
}

await admin.end();
await proxy.close();
process.exit(0);
