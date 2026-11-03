// Claims 2a and 2b: what one socket connect costs in cross-instance traffic, as a function of how
// many sockets the *other* instance already holds; a herd; and whether any credential crosses.
// Ported to the Redis cluster channel: RedisTap reads the adapter's pub/sub and stream and every
// instance inbox. Its positive controls: both instances' heartbeats and inbox boot entries, and a
// FETCH_SOCKETS the harness publishes itself, which the instances answer on the same channel.
// Run: REDIS_URL=... node --experimental-strip-types --no-warnings exp2-connect.ts
import { encode } from "@msgpack/msgpack";
import {
  bootInstance, connect, killInstance, KEYSPACE, out, q, register, resetData, RedisTap, secretsInStore,
  secretsInTables, sidOf, sleep, tally, ticket, waitForPeers, type Client, type Heard, type Instance,
} from "./lib.ts";
import { io as ioClient } from "socket.io-client";
import { PROTOCOL_VERSION } from "../../../../../../shared/protocol.ts";

const { log, save } = out("exp2.txt");
const instances: Instance[] = [];
const sockets: Client[] = [];
const tap = new RedisTap();

function perConnect(heard: Heard[]) {
  const n = (type: string) => heard.filter((h) => h.type === type).length;
  return {
    messages: heard.length,
    bytes: heard.reduce((a, h) => a + h.bytes, 0),
    fetchSockets: n("FETCH_SOCKETS"),
    responses: n("FETCH_SOCKETS_RESPONSE"),
    socketsInReplies: heard
      .filter((h) => h.type === "FETCH_SOCKETS_RESPONSE")
      .reduce((a, h) => a + (((h.msg?.data as { sockets?: unknown[] })?.sockets ?? []).length), 0),
    byType: Object.fromEntries(Object.entries(tally(heard)).map(([k, v]) => [k, v.n])),
  };
}

/** One client arriving the way SocketContext does it: connect (the server pushes the list), then friend:get_online_list. */
async function probeConnect(inst: Instance, cookie: string) {
  const mark = tap.mark();
  const t0 = Date.now();
  const socket = await connect(inst.url, cookie, "web");
  const lists: number[] = [];
  socket.on("friend:online_list", () => lists.push(Date.now() - t0));
  socket.emit("friend:get_online_list");
  const deadline = Date.now() + 8_000;
  while (lists.length < 2 && Date.now() < deadline) await sleep(20);
  await tap.settle();
  const heard = tap.since(mark);
  socket.close();
  await sleep(1_500);
  return { ...perConnect(heard), onlineListsAfterMs: lists };
}

const secrets: string[] = [];

try {
  await resetData();
  await tap.start();
  instances.push(await bootInstance("srvA", 5581));
  instances.push(await bootInstance("srvB", 5582));
  const [A, B] = instances;
  await waitForPeers(tap);
  const inboxes = tap.bootedInboxes();
  log(`# exp2: two instances up; positive control: heartbeats from ${tap.heartbeatUids().size} adapters, boot entries of ${inboxes.size} inboxes`);
  if (inboxes.size < 2) throw new Error("the tap did not read both instances' inbox boot entries");

  const users: { cookie: string; id: string; name: string }[] = [];
  const tag = Date.now().toString(36);
  for (let i = 0; i < 130; i++) {
    const name = `p${tag}${i}`;
    users.push({ ...(await register(i % 2 ? A.url : B.url, name)), name });
  }
  for (const u of users) secrets.push(u.cookie.replace(/^connect\.sid=/, ""), sidOf(u.cookie));
  const bUsers = users.slice(0, 100);
  const probes = users.slice(100, 105);
  const herd = users.slice(105, 130);
  // Friends on both sides, so the connect has someone to tell and someone to ask about.
  for (const p of probes) {
    for (const f of bUsers.slice(0, 5)) {
      await q(`INSERT INTO friends (user_id, friend_user_id, status) VALUES ($1,$2,'accepted'),($2,$1,'accepted')`, [p.id, f.id]);
    }
  }

  log("\n## positive control: a FETCH_SOCKETS published by the harness on the adapter's public channel");
  const controlMark = tap.mark();
  const controlSocket = await connect(B.url, bUsers[0]!.cookie, "web");
  await sleep(500);
  await tap.cmd.publish(
    `${KEYSPACE}:socket.io#/#`,
    Buffer.from(encode({ uid: "repro-tap", nsp: "/", type: 7, data: { requestId: "repro-control", opts: { rooms: [], except: [] } } }))
  );
  await tap.settle(1_000);
  const control = tap.heard.slice(controlMark);
  const controlReplies = control.filter((h) => h.type === "FETCH_SOCKETS_RESPONSE");
  const controlCarries = (await secretsInStore({ ...tap, heard: control } as RedisTap, secrets)).filter((w) => !w.startsWith("key "));
  log(`  tap heard FETCH_SOCKETS ${control.filter((h) => h.type === "FETCH_SOCKETS").length}, replies ${controlReplies.length}, sockets in replies ${perConnect(control).socketsInReplies}`);
  log(`  the replies carry a session credential (what a sweep would put on the channel): ${controlCarries.length > 0 ? "yes" : "no"} (values not printed)`);
  if (controlReplies.length < 2) throw new Error("the tap did not hear both instances answer the control FETCH_SOCKETS");
  if (controlCarries.length === 0) throw new Error("the credential scan did not find the session credential the control replies carry: its \"none\" below would be blind");
  controlSocket.close();
  await sleep(1_500);
  const afterControl = tap.mark();

  log("\n## 2a: one web connect on A, by sockets already on B (5 probes each, each with 5 friends on B)");
  log("N_on_B | cluster messages | bytes | FETCH_SOCKETS | responses | sockets carried in replies");
  const levels = [0, 10, 50, 100];
  let held = 0;
  const rows: Record<number, Awaited<ReturnType<typeof probeConnect>>[]> = {};
  for (const n of levels) {
    while (held < n) sockets.push(await connect(B.url, bUsers[held++]!.cookie, "web"));
    await sleep(2_000);
    rows[n] = [];
    for (const p of probes) rows[n].push(await probeConnect(A, p.cookie));
    const avg = (k: "messages" | "bytes" | "fetchSockets" | "responses" | "socketsInReplies") =>
      (rows[n].reduce((a, r) => a + r[k], 0) / rows[n].length).toFixed(1);
    log(`${String(n).padStart(6)} | ${avg("messages")} | ${avg("bytes")} | ${avg("fetchSockets")} | ${avg("responses")} | ${avg("socketsInReplies")}`);
  }
  log("by type, one probe at N=100:", rows[100]![0]!.byType);
  log("friend:online_list arrivals (ms after connect start), N=100 probes:", rows[100]!.map((r) => r.onlineListsAfterMs));

  log("\n## 2a herd: K clients connect at once, split evenly A/B, after the 100 on B leave");
  for (const s of sockets.splice(0)) s.close();
  await sleep(3_000);
  for (const k of [10, 25]) {
    const group = herd.slice(0, k);
    const mark = tap.mark();
    const conns = await Promise.all(
      group.map((u, i) => {
        const url = (i % 2 ? A : B).url;
        const s = ioClient(url, { auth: { protocolVersion: PROTOCOL_VERSION }, extraHeaders: { cookie: u.cookie }, transports: ["websocket"], reconnection: false, forceNew: true });
        return new Promise<Client>((resolve) => s.once("connect", () => { s.emit("friend:get_online_list"); resolve(s); }));
      })
    );
    await sleep(4_000);
    await tap.settle();
    const c = perConnect(tap.since(mark));
    log(`K=${k}: cluster messages ${c.messages} (${c.bytes} B), FETCH_SOCKETS ${c.fetchSockets}, replies ${c.responses}, sockets carried ${c.socketsInReplies}; by type ${JSON.stringify(c.byType)}`);
    for (const s of conns) s.close();
    await sleep(3_000);
  }

  log("\n## 2b: credentials on the cluster channel, in the store, in the database");
  const redeemed = await ticket(A.url, probes[0]!.cookie);
  secrets.push(redeemed);
  const native = ioClient(A.url, { auth: { ticket: redeemed, protocolVersion: PROTOCOL_VERSION }, transports: ["websocket"], reconnection: false, forceNew: true });
  await new Promise<void>((resolve, reject) => { native.once("connect", () => resolve()); native.once("connect_error", reject); });
  native.close();
  secrets.push(await ticket(A.url, probes[1]!.cookie));
  await sleep(1_000);
  const sinceControl = { ...tap, heard: tap.heard.slice(afterControl), cmd: tap.cmd } as RedisTap;
  const inStore = await secretsInStore(sinceControl, secrets);
  log(`  secrets looked for: ${users.length} cookies, ${users.length} session ids, 1 redeemed and 1 unspent ticket (values never printed)`);
  log(`  cluster messages heard after the control: ${tap.heard.length - afterControl}; every key in the store scanned`);
  log(`  found in cluster messages or store keys/values: ${inStore.length ? [...new Set(inStore)].join("; ") : "none"}`);
  const sessionControl = await secretsInTables(secrets, (await q<{ t: string }>(`SELECT DISTINCT table_name t FROM information_schema.columns WHERE table_schema='public' AND table_name <> 'session'`)).map((r) => r.t));
  log(`  table-scan positive control, the session store itself: ${sessionControl.length} hits, in ${[...new Set(sessionControl.map((w) => w.split(" ")[0]))].join(", ") || "NOTHING (scan blind)"}`);
  if (sessionControl.length === 0) throw new Error("the table scan did not find session ids in the session table");
  const inTables = await secretsInTables(secrets, ["session"]);
  log(`  found in any other table's text/json column: ${inTables.length ? inTables.join("; ") : "none"}`);
  const attachments = await q<{ n: number }>(`SELECT count(*)::int n FROM information_schema.tables WHERE table_name = 'socket_io_attachments'`);
  log(`  socket_io_attachments table exists: ${attachments[0]!.n > 0}`);

  log("\n## baseline: one instance only (B killed)");
  await killInstance(B);
  await sleep(12_000);
  const base = await probeConnect(A, probes[0]!.cookie);
  log("one connect on A alone:", base);
} catch (err) {
  log("FAILED", String((err as Error).stack ?? err));
} finally {
  for (const s of sockets) s.close();
  for (const i of instances) await killInstance(i);
  await tap.stop();
  save();
  process.exit(0);
}
