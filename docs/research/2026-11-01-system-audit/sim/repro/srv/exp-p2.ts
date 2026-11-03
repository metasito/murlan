// P2: half-open cluster links. The audit stalled A's Postgres LISTEN connection; the cluster now
// runs over Redis, so a TCP proxy sits between instance A and Redis and every connection A holds
// is stalled at once (bytes stop both ways, sockets stay open), while connections A opens after
// still forward: a partition that heals for new flows. Measures whether A notices, how long until
// it hears its peers again, what /health says meanwhile, and P6's router: how long a client on B
// waits for an answer about a room the deaf A owns.
import {
  bootInstance, connect, out, PgProxy, q, RedisTap, register, resetData, scrapeMetrics, sleep, waitForPeers,
  KEYSPACE, REDIS_URL, type Client, type Instance,
} from "./lib.ts";
import type { WireRoomState } from "../../../../../../shared/protocol.ts";

const { log, save } = out("exp-p2.txt");
const instances: Instance[] = [];
const tap = new RedisTap();
const redis = new URL(REDIS_URL);
const proxy = new PgProxy(Number(redis.port || 6379));
const PROXY_PORT = 55992;

async function openTableOn(inst: Instance, cookies: { cookie: string }[]): Promise<WireRoomState> {
  const sockets: Client[] = [];
  for (const c of cookies) sockets.push(await connect(inst.url, c.cookie, "web"));
  const room = await new Promise<WireRoomState>((resolve) => {
    sockets[0]!.once("room:state", resolve);
    sockets[0]!.emit("room:create", { gameMode: "free_for_all", maxPlayers: cookies.length });
  });
  for (const s of sockets.slice(1)) await new Promise<void>((r) => { s.once("room:state", () => r()); s.emit("room:join", { code: room.code }); });
  sockets[0]!.emit("room:start");
  await sleep(1_000);
  for (const s of sockets) s.close();
  return room;
}

const presenceOf = async (userId: string) => {
  const value = await tap.cmd.get(`${KEYSPACE}:online:${userId}`);
  const hash = { instance: value ? value.split(/[^0-9a-f-]/)[0] : "" };
  const live: string[] = [];
  for await (const keys of tap.cmd.scanIterator({ MATCH: `${KEYSPACE}:instance:*`, COUNT: 100 })) live.push(...keys.map((k) => k.slice(-8)));
  return `presence ${hash.instance ? `on instance ${hash.instance.slice(-8)}` : "NONE"}; live instance keys ${live.join(",") || "none"}`;
};

const reconnects = async (inst: Instance) =>
  ((await scrapeMetrics(inst.url)).get("redis_reconnects_total") ?? []).map((l) => Number(l.split(" ").at(-1))).reduce((a, b) => a + b, 0);

try {
  await resetData();
  await tap.start();
  await proxy.listen(PROXY_PORT);
  instances.push(await bootInstance("srvA", 5581, { redisUrl: `redis://127.0.0.1:${PROXY_PORT}${redis.pathname}` }));
  instances.push(await bootInstance("srvB", 5582));
  const [A, B] = instances as [Instance, Instance];
  await waitForPeers(tap);
  log("# exp-p2: every Redis connection of A stalled via a TCP proxy (half-open); new connections forward");

  const tag = Date.now().toString(36);
  const x = await register(A.url, `x${tag}`);
  const partner = await register(A.url, `p${tag}`);
  const friendOfX = await register(B.url, `f${tag}`);
  await q(`INSERT INTO friends (user_id, friend_user_id, status) VALUES ($1,$2,'accepted'),($2,$1,'accepted')`, [x.id, friendOfX.id]);
  const room = await openTableOn(A, [x, partner]);
  const ownerA = (await q<{ n: number }>(
    `SELECT count(*)::int n FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid WHERE l.locktype='advisory' AND a.application_name='srvA'`
  ))[0]!.n;
  log(`table ${room.code} started on A; advisory locks held by srvA: ${ownerA}`);

  const xOnA = await connect(A.url, x.cookie, "web");
  await sleep(500);
  const statuses: { t: number; p: unknown }[] = [];
  xOnA.on("friend:status", (p: unknown) => statuses.push({ t: Date.now(), p }));
  const fSock1 = await connect(B.url, friendOfX.cookie, "web");
  const ctlDeadline = Date.now() + 5_000;
  while (statuses.length === 0 && Date.now() < ctlDeadline) await sleep(50);
  log(`control (before stall): X on A heard friend:status for a friend connecting on B -> ${statuses.length ? "yes" : "NO"}`);
  if (statuses.length === 0) throw new Error("positive control failed: no friend:status across instances before the stall");
  fSock1.close();
  await sleep(1_500);

  log(`X before the stall: ${await presenceOf(x.id)}`);
  const reconnectsBefore = await reconnects(A);
  const live = proxy.pairs.filter((p) => !p.down.destroyed);
  for (const p of live) proxy.stall(p);
  const pairsAtStall = proxy.pairs.length;
  const stallAt = Date.now();
  const stallMark = tap.mark();
  log(`stalled ${live.length} connections of A at t0; their sockets stay open`);

  // P6/D18: a client on B asks for A's room while A cannot read its inbox.
  // The partner, not X: one socket per account, so X connecting on B would evict X's socket on A.
  const xOnB = await connect(B.url, partner.cookie, "web");
  const rejoin = (async () => {
    const t = performance.now();
    const reply = await new Promise<unknown>((resolve) => {
      xOnB.emit("game:rejoin", { roomId: room.roomId }, (r: unknown) => resolve(r));
      setTimeout(() => resolve("NO_ACK_IN_25s"), 25_000);
    });
    return { reply, ms: performance.now() - t };
  })();

  statuses.length = 0;
  const fSock2 = await connect(B.url, friendOfX.cookie, "web");
  const sentAt = Date.now();
  const healthDuring = await fetch(`${A.url}/health/ready`).then(async (r) => ({ status: r.status, body: await r.json() as Record<string, unknown> }));
  const { reply, ms } = await rejoin;
  const waitStatus = Date.now() + 30_000;
  while (statuses.length === 0 && Date.now() < waitStatus) await sleep(100);
  const firstNewPair = proxy.pairs[pairsAtStall];
  const toInboxes = tap.heard.slice(stallMark).filter((h) => h.via === "inbox" && h.type !== "boot").map((h) => `${h.type} to inbox ${h.key.slice(-8)} at +${h.t - stallAt} ms`);

  const firstHeard = statuses[0]?.t;
  const presenceAfterWait = await presenceOf(x.id);
  // After A is back: the friend goes offline and comes back on B, so a second notice is sent to a healthy A.
  fSock2.close();
  await sleep(1_500);
  statuses.length = 0;
  const fSock3 = await connect(B.url, friendOfX.cookie, "web");
  const secondAt = Date.now();
  const waitSecond = Date.now() + 15_000;
  while (!statuses.some((st) => (st.p as { online?: boolean }).online) && Date.now() < waitSecond) await sleep(100);
  const second = statuses.find((st) => (st.p as { online?: boolean }).online);
  fSock3.close();
  const presenceAtEnd = await presenceOf(x.id);

  log(`\n## detection and recovery`);
  log(`  first new connection from A through the proxy: ${firstNewPair ? `+${firstNewPair.at - stallAt} ms` : "none"}; connections A opened after the stall: ${proxy.pairs.length - pairsAtStall}`);
  log(`  X on A heard the friend-online status sent from B at +${sentAt - stallAt} ms: ${firstHeard ? `yes, at +${firstHeard - stallAt} ms after the stall` : "NO within 30 s"}`);
  log(`  inbox entries written during that wait (inbox key's last 8 chars): ${toInboxes.join("; ") || "none"} (A's own boot entries excluded)`);
  log(`  after A reconnected, the friend reconnected on B at +${secondAt - stallAt} ms: X on A heard it ${second ? `after ${second.t - secondAt} ms (+${second.t - stallAt} ms after the stall)` : "NOT within 15 s"}`);
  log(`  X (still connected to A) after the first wait: ${presenceAfterWait}; at the end: ${presenceAtEnd}`);
  log(`  bytes queued on the stalled connections, Redis to A: ${live.reduce((a, p) => a + p.heldDown.reduce((x, b) => x + b.length, 0), 0)} B`);
  const alog = (await import("node:fs")).readFileSync(A.logFile, "utf8");
  log(`  A logged "Redis unreachable": ${/Redis unreachable/.test(alog) ? "yes" : "no"}; "Redis reachable again": ${/Redis reachable again/.test(alog) ? "yes" : "no"}`);
  log(`  redis_reconnects_total on A: ${reconnectsBefore} before, ${await reconnects(A)} after`);
  log(`  A GET /health/ready during the stall: ${healthDuring.status}, body ${JSON.stringify(healthDuring.body)}`);

  log(`\n## P6 router: B's game:rejoin for the room deaf A owns`);
  log(`  returned ${JSON.stringify(reply)} after ${ms.toFixed(0)} ms (client budget: sendIntent 4 s a try)`);
  xOnB.close();
  xOnA.close();
} catch (err) {
  log("FAILED", String((err as Error).stack ?? err));
} finally {
  for (const i of instances) { if (i.child.exitCode === null) i.child.kill("SIGKILL"); }
  await sleep(300);
  await proxy.close();
  await tap.stop();
  save();
  process.exit(0);
}
