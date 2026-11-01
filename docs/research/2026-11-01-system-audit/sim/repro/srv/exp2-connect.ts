// Claims 2a and 2b: what one socket connect costs in cross-instance traffic, as a function of how
// many sockets the *other* instance already holds; a herd; and what the swept handshakes carry.
// Run: node --experimental-strip-types --no-warnings exp2-connect.ts
import {
  bootInstance, connect, killInstance, NotifyTap, once, out, q, redact, register, resetData,
  sleep, summarise, waitForPeers, MSG, ticket, type Client, type Instance, type Tapped,
} from "./lib.ts";
import { io as ioClient } from "socket.io-client";
import { PROTOCOL_VERSION } from "../../../../../../shared/protocol.ts";

const { log, save } = out("exp2.txt");
const instances: Instance[] = [];
const sockets: Client[] = [];
const tap = new NotifyTap();

function perConnect(msgs: Tapped[]) {
  const s = summarise(msgs);
  const pick = (k: string) => s[k] ?? { n: 0, bytes: 0, attachments: 0, attachmentBytes: 0 };
  const resp = pick("FETCH_SOCKETS_RESPONSE");
  return {
    notifies: msgs.length,
    fetchSockets: pick("FETCH_SOCKETS").n,
    responses: resp.n,
    responseNotifyBytes: resp.bytes,
    attachmentInserts: msgs.filter((m) => m.attachmentId).length,
    attachmentBytes: msgs.reduce((a, m) => a + (m.attachmentBytes ?? 0), 0),
    socketsInReplies: msgs
      .filter((m) => m.type === 8)
      .reduce((a, m) => a + (((m.msg?.data as { sockets?: unknown[] })?.sockets ?? []).length), 0),
    byType: Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v.n])),
  };
}

/** One client arriving the way SocketContext does it: connect, then friend:get_online_list. */
async function probeConnect(inst: Instance, cookie: string) {
  const mark = tap.mark();
  const t0 = Date.now();
  const socket = await connect(inst.url, cookie, "web");
  const lists: number[] = [];
  socket.on("friend:online_list", () => lists.push(Date.now() - t0));
  socket.emit("friend:get_online_list");
  const deadline = Date.now() + 8_000;
  while (lists.length < 2 && Date.now() < deadline) await sleep(20);
  await sleep(300);
  await tap.settle();
  const msgs = tap.since(mark);
  socket.close();
  await sleep(1_500);
  return { ...perConnect(msgs), onlineListsAfterMs: lists };
}

try {
  await resetData();
  instances.push(await bootInstance("srvA", 5581));
  instances.push(await bootInstance("srvB", 5582));
  const [A, B] = instances;
  await tap.start();
  await waitForPeers(tap);
  log("# exp2: two instances up, adapter peers seen on the tap");

  const users: { cookie: string; id: string; name: string }[] = [];
  const tag = Date.now().toString(36);
  for (let i = 0; i < 130; i++) {
    const name = `p${tag}${i}`;
    users.push({ ...(await register(i % 2 ? A.url : B.url, name)), name });
  }
  const bUsers = users.slice(0, 100);
  const probes = users.slice(100, 105);
  const herd = users.slice(105, 130);

  log("\n## 2a: one web connect on A, by sockets already on B (5 probes each)");
  log("N_on_B | notifies | FETCH_SOCKETS | responses | resp notify bytes | attachment INSERTs | attachment bytes | sockets carried in replies");
  const levels = [0, 10, 50, 100];
  let held = 0;
  const rows: Record<number, ReturnType<typeof perConnect>[]> = {};
  for (const n of levels) {
    while (held < n) sockets.push(await connect(B.url, bUsers[held++]!.cookie, "web"));
    await sleep(2_000);
    rows[n] = [];
    for (const p of probes) rows[n].push(await probeConnect(A, p.cookie));
    const avg = (k: keyof ReturnType<typeof perConnect>) =>
      (rows[n].reduce((a, r) => a + (r[k] as number), 0) / rows[n].length).toFixed(1);
    log(
      `${String(n).padStart(6)} | ${avg("notifies")} | ${avg("fetchSockets")} | ${avg("responses")} | ${avg("responseNotifyBytes")} | ${avg("attachmentInserts")} | ${avg("attachmentBytes")} | ${avg("socketsInReplies")}`
    );
  }
  log("by type, one probe at N=100:", rows[100][0].byType);
  log("friend:online_list arrivals (ms after connect start), N=100 probes:", rows[100].map((r) => r.onlineListsAfterMs));

  log("\n## 2b: what a swept socket carries (from a FETCH_SOCKETS_RESPONSE attachment at N=100)");
  const reply = tap.msgs.filter((m) => m.type === 8 && m.attachmentId && m.msg).at(-1);
  const swept = ((reply?.msg?.data as { sockets?: Record<string, unknown>[] })?.sockets ?? [])[0];
  if (swept) {
    const hs = swept.handshake as Record<string, unknown>;
    log("socket keys:", Object.keys(swept));
    log("handshake keys:", Object.keys(hs));
    log("handshake.headers keys:", Object.keys(hs.headers as object));
    log("handshake.auth keys:", Object.keys(hs.auth as object));
    log("socket.data keys:", Object.keys(swept.data as object));
    log("redacted sample:", redact(JSON.stringify({ headers: hs.headers, auth: hs.auth, data: swept.data })).slice(0, 900));
    const att = await q<{ id: number; n: number; has_cookie: boolean; has_ticket: boolean }>(
      `SELECT id, octet_length(payload) n, position('connect.sid' in encode(payload,'escape')) > 0 has_cookie,
              position('ticket' in encode(payload,'escape')) > 0 has_ticket
         FROM socket_io_attachments ORDER BY id DESC LIMIT 3`
    );
    log("socket_io_attachments rows (latest 3) contain the strings:", att);
    // The task asks which fields are present, redacted. Whether the credentials are live is read
    // from code (ticket TTL, cookie max-age, the handshake never redeeming the web ticket), not by
    // replaying captured secrets.
  } else log("no attachment reply captured");

  log("\n## 2a herd: K clients connect at once, split evenly A/B, after the 100 on B leave");
  for (const s of sockets.splice(0)) s.close();
  await sleep(3_000);
  for (const k of [10, 25]) {
    const group = herd.slice(0, k);
    const mark = tap.mark();
    const tickets = await Promise.all(group.map((u, i) => ticket((i % 2 ? A : B).url, u.cookie)));
    const conns = await Promise.all(
      group.map((u, i) => {
        const url = (i % 2 ? A : B).url;
        const s = ioClient(url, { auth: { ticket: tickets[i], protocolVersion: PROTOCOL_VERSION }, extraHeaders: { cookie: u.cookie }, transports: ["websocket"], reconnection: false, forceNew: true });
        return new Promise<Client>((resolve) => s.once("connect", () => { s.emit("friend:get_online_list"); resolve(s); }));
      })
    );
    await sleep(4_000);
    await tap.settle();
    const c = perConnect(tap.since(mark));
    log(`K=${k}: notifies ${c.notifies}, FETCH_SOCKETS ${c.fetchSockets}, replies ${c.responses}, sockets carried in replies ${c.socketsInReplies}, attachment INSERTs ${c.attachmentInserts}, attachment bytes ${c.attachmentBytes}, reply NOTIFY bytes ${c.responseNotifyBytes}`);
    for (const s of conns) s.close();
    await sleep(3_000);
  }

  log("\n## baseline: one instance only (B killed, A drops it after the heartbeat timeout)");
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
void MSG;
