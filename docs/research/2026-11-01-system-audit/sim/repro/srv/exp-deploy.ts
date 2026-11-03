// P5/P6 on a graceful deploy: A owns a table; A is shut down over IPC (the app's own shutdown());
// a client reconnects on B and rejoins while A drains. Measures when A releases the room's advisory
// lock relative to io.close()/exit, what the rejoiner sees, and how long it takes to recover.
// Ported to the Redis channel: the leaving notice is the adapter's "murlan:adapter-leaving"
// server-side emit, and the hand-off travels to B's inbox, both read by RedisTap.
import {
  bootInstance, connect, RedisTap, out, q, register, resetData, sleep, waitForPeers,
  type Client, type Instance,
} from "./lib.ts";
import type { WireGameState, WireRoomState } from "../../../../../../shared/protocol.ts";
import { ownershipKey } from "../../../../../../server/game/gameOwnership.ts";

const { log, save } = out("exp-deploy.txt");
const instances: Instance[] = [];
const tap = new RedisTap();
const T0 = Date.now();
const rel = (t: number) => `${((t - T0) / 1000).toFixed(2)}s`;

async function openTableOn(inst: Instance, cookies: { cookie: string }[]): Promise<{ sockets: Client[]; room: WireRoomState; states: (WireGameState | null)[] }> {
  const sockets: Client[] = [];
  for (const c of cookies) sockets.push(await connect(inst.url, c.cookie, "web"));
  const states: (WireGameState | null)[] = sockets.map(() => null);
  sockets.forEach((s, i) => s.on("game:state", (st: WireGameState, ack?: () => void) => { states[i] = st; ack?.(); }));
  const room = await new Promise<WireRoomState>((resolve) => {
    sockets[0].once("room:state", resolve);
    sockets[0].emit("room:create", { gameMode: "free_for_all", maxPlayers: cookies.length });
  });
  for (const s of sockets.slice(1)) await new Promise<void>((r) => { s.once("room:state", () => r()); s.emit("room:join", { code: room.code }); });
  sockets[0].emit("room:start");
  const start = Date.now();
  while (!states.every(Boolean) && Date.now() - start < 10_000) await sleep(50);
  return { sockets, room, states };
}

async function lockHeld(roomId: string, appName: string): Promise<boolean> {
  const key = BigInt(ownershipKey(roomId));
  // A bigint advisory lock: classid = high 32 bits, objid = low 32 bits.
  const classid = Number(BigInt.asIntN(32, key >> 32n));
  const objid = Number(BigInt.asIntN(32, key & 0xffffffffn)) >>> 0;
  const rows = await q<{ n: number }>(
    `SELECT count(*)::int n FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid
      WHERE l.locktype='advisory' AND a.datname='murlan_repro_srv' AND a.application_name=$1
        AND l.classid=$2 AND l.objid=$3`,
    [appName, classid, objid]
  );
  return rows[0].n > 0;
}

/** A raw rejoin with its own ack timeout, so the router's full wait can be observed. */
function rejoin(socket: Client, roomId: string, timeoutMs: number): Promise<{ ms: number; reply: unknown }> {
  const t = performance.now();
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ ms: performance.now() - t, reply: "NO_ACK" }), timeoutMs);
    socket.emit("game:rejoin", { roomId }, (reply: unknown) => { clearTimeout(timer); resolve({ ms: performance.now() - t, reply }); });
  });
}

try {
  await resetData();
  await tap.start();
  instances.push(await bootInstance("srvA", 5581));
  instances.push(await bootInstance("srvB", 5582, { env: { MURLAN_LOBBY_GRACE_MS: "3000", MURLAN_DISCONNECT_GRACE_MS: "60000" } }));
  const [A, B] = instances;
  await waitForPeers(tap);
  log("# exp-deploy: A owns a table, A shut down gracefully (IPC), client rejoins on B");

  const tag = Date.now().toString(36);
  const players = [await register(A.url, `x${tag}`), await register(A.url, `y${tag}`)];
  const { sockets, room } = await openTableOn(A, players);
  await sleep(500);
  log(`table ${room.code} started on A; lock held by srvA: ${await lockHeld(room.roomId, "srvA")}, by srvB: ${await lockHeld(room.roomId, "srvB")}`);

  // Poll the advisory lock by instance, every 25 ms, across the shutdown.
  const lockLog: string[] = [];
  let prevA = true;
  let prevB = false;
  let releasedA: number | null = null;
  let heldB: number | null = null;
  const poll = setInterval(async () => {
    const a = await lockHeld(room.roomId, "srvA").catch(() => prevA);
    const b = await lockHeld(room.roomId, "srvB").catch(() => prevB);
    if (a !== prevA) { lockLog.push(`${rel(Date.now())} srvA lock -> ${a ? "held" : "released"}`); prevA = a; if (!a) releasedA ??= Date.now(); }
    if (b !== prevB) { lockLog.push(`${rel(Date.now())} srvB lock -> ${b ? "held" : "released"}`); prevB = b; if (b) heldB ??= Date.now(); }
  }, 25);

  // Reconnect player x on B before shutdown, so the only variable is the rejoin timing.
  for (const s of sockets) s.close();
  await sleep(300);
  const xOnB = await connect(B.url, players[0].cookie, "web");
  let xState: WireGameState | null = null;
  xOnB.on("game:state", (st: WireGameState, ack?: () => void) => { xState = st; ack?.(); });

  // Shut A down; mark the leaving notice from the tap.
  const adapterCloseMark = tap.mark();
  const shutdownAt = Date.now();
  log(`${rel(Date.now())} sending shutdown to A`);
  A.child.send("shutdown");
  const acDeadline = Date.now() + 5_000;
  const leaving = () => tap.heard.slice(adapterCloseMark).find((m) => m.event === "murlan:adapter-leaving");
  while (!leaving() && Date.now() < acDeadline) await sleep(20);
  const ac = leaving();
  log(`${rel(Date.now())} adapter-leaving seen on tap: ${ac ? "yes at " + rel(ac.t) : "NO (never observed)"}`);

  // Emulate useRejoin: SERVER_ERROR/TABLE_UNREACHABLE retried every 2 s, up to 3 attempts.
  const outcomes: string[] = [];
  let recovered = false;
  for (let attempt = 0; attempt < 4 && !recovered; attempt++) {
    const { ms, reply } = await rejoin(xOnB, room.roomId, 20_000);
    const r = reply as { ok?: boolean; code?: string } | string;
    outcomes.push(`${rel(Date.now())} attempt ${attempt}: ${JSON.stringify(r)} after ${ms.toFixed(0)} ms`);
    if (typeof r === "object" && r.ok) { recovered = true; break; }
    await sleep(2_000);
    if (xState) { recovered = true; outcomes.push(`${rel(Date.now())} game:state arrived on B, seat ${(xState as WireGameState).viewerSeatIndex}`); break; }
  }
  await A.exited;
  log(`${rel(Date.now())} A exited; A IPC events: ${A.events.map((e) => `${e.ev}@${rel(e.t as number)}`).join(", ")}`);
  clearInterval(poll);
  await sleep(200);

  log("\n## advisory lock timeline");
  for (const l of lockLog) log("  " + l);
  const ioCloseAt = A.events.find((e) => e.ev === "io.close-start")?.t as number | undefined;
  log(`  hand-off: srvA released ${releasedA ? rel(releasedA) : "never seen"}, srvB held ${heldB ? rel(heldB) : "never seen"}; ` +
    `gap ${releasedA && heldB ? `${heldB - releasedA} ms` : "n/a"}; shutdown to srvB holding ${heldB ? `${heldB - shutdownAt} ms` : "n/a"}; ` +
    `srvA released ${releasedA && ioCloseAt ? `${ioCloseAt - releasedA} ms before io.close` : "n/a"}`);
  const handOff = tap.heard.slice(adapterCloseMark).filter((h) => h.via === "inbox").map((h) => `${h.type}@${rel(h.t)}`);
  log(`  inbox messages during the shutdown: ${handOff.join(", ") || "none"}`);
  log("\n## x rejoin on B (useRejoin emulation: 2 s x 3 on SERVER_ERROR)");
  for (const o of outcomes) log("  " + o);
  log(`recovered on B: ${recovered}`);

  log("\n## router wait on B while A still holds the lock (one raw rejoin, 20 s ack budget)");
  log("  (compared against sendIntent's budget 4 s x 3 = ~12 s, and useRejoin's 2 s x 3 = 6 s)");
  const sample = outcomes.find((o) => o.includes("TABLE_UNREACHABLE") || o.includes("SERVER_ERROR") || o.includes("NO_LIVE_GAME"));
  log("  first non-ok rejoin:", sample ?? "(none; recovered immediately)");

  xOnB.close();
} catch (err) {
  log("FAILED", String((err as Error).stack ?? err));
} finally {
  for (const i of instances) { if (i.child.exitCode === null) i.child.kill("SIGKILL"); }
  await tap.stop();
  save();
  process.exit(0);
}
