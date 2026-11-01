// P2: a half-open adapter LISTEN connection. A TCP proxy sits between instance A's pools and
// Postgres; the pair carrying A's adapter LISTEN is stalled (bytes stop flowing, socket stays open).
// Shows A goes deaf to the cluster, /health stays 200, nothing reconnects. Also P6's router wait:
// a client on B routing to a room the deaf A owns waits the router's full budget, not ~instant.
import {
  bootInstance, connect, NotifyTap, out, PgProxy, q, register, resetData, sleep, waitForPeers,
  type Client, type Instance,
} from "./lib.ts";
import type { WireRoomState } from "../../../../../../shared/protocol.ts";

const { log, save } = out("exp-p2.txt");
const instances: Instance[] = [];
const tap = new NotifyTap();
const proxy = new PgProxy();
const PROXY_PORT = 55991;

async function openTableOn(inst: Instance, cookies: { cookie: string }[]): Promise<WireRoomState> {
  const sockets: Client[] = [];
  for (const c of cookies) sockets.push(await connect(inst.url, c.cookie, "web"));
  const room = await new Promise<WireRoomState>((resolve) => {
    sockets[0].once("room:state", resolve);
    sockets[0].emit("room:create", { gameMode: "free_for_all", maxPlayers: cookies.length });
  });
  for (const s of sockets.slice(1)) await new Promise<void>((r) => { s.once("room:state", () => r()); s.emit("room:join", { code: room.code }); });
  sockets[0].emit("room:start");
  await sleep(1_000);
  for (const s of sockets) s.close();
  return room;
}

try {
  await resetData();
  await proxy.listen(PROXY_PORT);
  // A's pools all go through the proxy (127.0.0.1, IPv4). B connects to Postgres directly.
  instances.push(await bootInstance("srvA", 5581, { dbUrl: `postgres://postgres@127.0.0.1:${PROXY_PORT}/murlan_repro_srv` }));
  instances.push(await bootInstance("srvB", 5582));
  const [A, B] = instances;
  await tap.start();
  await waitForPeers(tap);
  log("# exp-p2: A's adapter LISTEN stalled via a TCP proxy (half-open)");

  const tag = Date.now().toString(36);
  // X and a partner on A, so A owns a started table; a friend of X on B for the presence test.
  const x = await register(A.url, `x${tag}`);
  const partner = await register(A.url, `p${tag}`);
  const friendOfX = await register(B.url, `f${tag}`);
  // Make X and friendOfX friends (direct rows).
  await q(`INSERT INTO friends (user_id, friend_user_id, status) VALUES ($1,$2,'accepted'),($2,$1,'accepted')`, [x.id, friendOfX.id]);
  const room = await openTableOn(A, [x, partner]);
  const ownerA = (await q<{ n: number }>(
    `SELECT count(*)::int n FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid WHERE l.locktype='advisory' AND a.application_name='srvA'`
  ))[0].n;
  log(`table ${room.code} started on A; advisory locks held by srvA: ${ownerA}`);

  // Positive control: X reconnects on A; friendOfX connecting on B should hear friend:status online.
  const xOnA = await connect(A.url, x.cookie, "web");
  await sleep(500);
  let heardStatus: unknown = null;
  xOnA.on("friend:status", (p: unknown) => (heardStatus = p));
  const fSock1 = await connect(B.url, friendOfX.cookie, "web");
  await sleep(1_500);
  log(`control (before stall): X on A heard friend:status for friend connecting on B -> ${heardStatus ? "yes" : "no"}`);
  fSock1.close();
  await sleep(1_000);

  // Find A's adapter LISTEN backend and stall exactly its proxy pair.
  const listenRows = await q<{ client_port: number }>(
    `SELECT client_port FROM pg_stat_activity WHERE application_name='srvA' AND query LIKE 'LISTEN%'`
  );
  const listenPorts = new Set(listenRows.map((r) => r.client_port));
  const pair = proxy.pairs.find((p) => !p.up.destroyed && listenPorts.has(p.up.localPort ?? -1));
  log(`srvA LISTEN backend client_port(s): ${[...listenPorts].join(",")}; matched proxy pair: ${pair ? "yes" : "NO"}`);
  if (!pair) throw new Error("could not isolate A's LISTEN connection");
  proxy.stall(pair);
  const stallAt = Date.now();
  log(`stalled A's LISTEN pair at t0; its socket stays open (destroyed=${pair.up.destroyed})`);

  // 1) An emit from B to X (on A): friend:status when friendOfX reconnects on B. Should never arrive.
  heardStatus = null;
  const fSock2 = await connect(B.url, friendOfX.cookie, "web");
  const waitStatus = Date.now() + 15_000;
  while (!heardStatus && Date.now() < waitStatus) await sleep(200);
  log(`after stall: X on A heard the friend-online status from B within 15 s -> ${heardStatus ? "yes" : "NO (A is deaf)"}`);
  log(`  held bytes queued on the stalled pair (down->A): ${pair.heldDown.reduce((a, b) => a + b.length, 0)} B (Postgres sent, A never received)`);

  // 2) A /health still 200.
  const health = await fetch(`${A.url}/health`).then((r) => r.json() as Promise<Record<string, unknown>>);
  log(`A /health: status ${health.status}, db ${health.db}, adapterPool ${JSON.stringify(health.adapterPool)}`);

  // 3) No new LISTEN backend for srvA, no new proxy pair carrying LISTEN, no adapter error in A's log.
  await sleep(1_000);
  const stillListening = await q<{ n: number }>(`SELECT count(*)::int n FROM pg_stat_activity WHERE application_name='srvA' AND query LIKE 'LISTEN%'`);
  log(`srvA LISTEN backends now: ${stillListening[0].n} (reconnect would make 2); proxy pairs that ever carried LISTEN: ${proxy.pairs.filter((p) => p.sawListen).length}`);
  const alog = (await import("node:fs")).readFileSync(A.logFile, "utf8");
  log(`A log mentions "adapter error"/"not reaching other instances": ${/not reaching other instances|adapter error/i.test(alog) ? "yes" : "no"}`);

  // 4) B's friend:online_list latency: B still counts A as a peer, so the sweep waits A out (~5 s).
  const fSock3 = fSock2;
  const t = performance.now();
  const listLatency = await new Promise<number>((resolve) => {
    fSock3.once("friend:online_list", () => resolve(performance.now() - t));
    fSock3.emit("friend:get_online_list");
    setTimeout(() => resolve(-1), 10_000);
  });
  log(`B friend:online_list latency while A is deaf: ${listLatency < 0 ? ">10 s" : listLatency.toFixed(0) + " ms"} (adapter DEFAULT_TIMEOUT is 5 s)`);

  // 5) P6 router wait: a client on B routes a rejoin to the room the deaf A owns. B still sees A as
  //    a peer, so every attempt waits the 5 s ack timeout; 3 attempts -> ~15 s -> TABLE_UNREACHABLE.
  const xOnB = await connect(B.url, x.cookie, "web");
  const rt = performance.now();
  const reply = await new Promise<unknown>((resolve) => {
    xOnB.emit("game:rejoin", { roomId: room.roomId }, (r: unknown) => resolve(r));
    setTimeout(() => resolve("NO_ACK_IN_25s"), 25_000);
  });
  const routerMs = performance.now() - rt;
  log(`\n## P6 router wait (deaf owner holding the lock)`);
  log(`  B's game:rejoin for A's room returned ${JSON.stringify(reply)} after ${routerMs.toFixed(0)} ms`);
  log(`  client budgets: sendIntent 4 s x 3 = ~12 s; useRejoin 2 s x 3 = 6 s; this is longer, so the client gives up first`);
  xOnB.close();
  fSock2.close();
  xOnA.close();
  void stallAt;
} catch (err) {
  log("FAILED", String((err as Error).stack ?? err));
} finally {
  // Kill A before closing the proxy, or A's adapter loops reconnecting into a closed port.
  for (const i of instances) { if (i.child.exitCode === null) i.child.kill("SIGKILL"); }
  await sleep(300);
  await proxy.close();
  await tap.stop();
  save();
  process.exit(0);
}
