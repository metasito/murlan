// Shared harness for the server-side reproductions: boots real server processes (instance.ts)
// against murlan_repro_srv and a Redis-protocol store, registers users, opens sockets the way the
// web and native clients do, taps the cluster channel (RedisTap; NotifyTap is the Postgres
// adapter's, kept for the history it recorded), and reads the shared Postgres statement log by PID.
import pg from "pg";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { io as ioClient, type Socket } from "socket.io-client";
import { decode } from "@msgpack/msgpack";
import { createClient } from "redis";
import { PROTOCOL_VERSION } from "../../../../../../shared/protocol.ts";

export const ROOT = path.resolve(import.meta.dirname, "../../../../../..");
export const SRV = import.meta.dirname;
export const RESULTS = path.resolve(ROOT, "docs/research/2026-11-01-system-audit/sim/results");
export const SCRATCH = process.env.REPRO_SCRATCH ?? path.join(os.tmpdir(), "murlan-repro-srv");
/** The Postgres server's log file; log_statement=all lands there. */
export const PG_LOG = process.env.PGLOG ?? "";
export const DB = "murlan_repro_srv";
export const PG_PORT = Number(process.env.PGPORT ?? 55432);
export const DB_URL = `postgres://postgres@localhost:${PG_PORT}/${DB}`;
/** A store of the instances' own, never a shared one: resetData deletes every key under `murlan:`. */
export const REDIS_URL = process.env.REDIS_URL ?? "";
if (!REDIS_URL) throw new Error("REDIS_URL is required: a disposable Redis-protocol store for the repro instances");
/** The keyspace the instances use: server/store/redis.ts keyspace() of a DATABASE_URL with no search_path. */
export const KEYSPACE = "murlan";
/** The bearer token every repro instance's /metrics answers to. */
export const METRICS_TOKEN = "repro-metrics-token-not-for-production";
fs.mkdirSync(SCRATCH, { recursive: true });

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const admin = new pg.Pool({ connectionString: `${DB_URL}?application_name=harness`, max: 3 });
export const q = async <R = Record<string, unknown>>(sql: string, params?: unknown[]) =>
  (await admin.query(sql, params)).rows as R[];

/** Rows the app writes, emptied between experiments; the schema stays. */
export async function resetData() {
  await q(`TRUNCATE users, auth_tokens, bug_reports, client_errors, events, friends, rooms, game_invites,
    push_tokens, room_players, round_history, round_replays, server_errors,
    socket_ticket_nonces, user_achievements, user_ratings, user_stats, session, active_games CASCADE`);
  const r = createClient({ url: REDIS_URL });
  await r.connect();
  for await (const keys of r.scanIterator({ MATCH: `${KEYSPACE}:*`, COUNT: 500 })) if (keys.length) await r.del(keys);
  await r.destroy();
}

// ── instances ───────────────────────────────────────────────────────────────

export interface Instance {
  name: string;
  port: number;
  url: string;
  child: ChildProcess;
  events: { ev: string; t: number; [k: string]: unknown }[];
  logFile: string;
  exited: Promise<number | null>;
}

const PIDS = path.join(SCRATCH, "pids.txt");

export async function bootInstance(
  name: string,
  port: number,
  { env = {}, dbUrl = DB_URL, redisUrl = REDIS_URL }: { env?: Record<string, string>; dbUrl?: string; redisUrl?: string } = {}
): Promise<Instance> {
  const logFile = path.join(SCRATCH, `${name}-${Date.now()}.log`);
  const fd = fs.openSync(logFile, "w");
  const child = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", path.join(SRV, "instance.ts")], {
    cwd: ROOT,
    env: {
      ...process.env,
      DATABASE_URL: `${dbUrl}?application_name=${name}`,
      REDIS_URL: redisUrl,
      METRICS_TOKEN,
      PORT: String(port),
      SESSION_SECRET: "repro-srv-secret-not-for-production",
      NODE_ENV: "development",
      MURLAN_AUTH_RATE_LIMIT: "100000",
      MURLAN_TICKET_RATE_LIMIT: "100000",
      MURLAN_SWEEP_INTERVAL_MS: String(24 * 3600_000),
      ...env,
    },
    stdio: ["ignore", fd, fd, "ipc"],
  });
  fs.appendFileSync(PIDS, `${child.pid} ${name}\n`);
  const events: Instance["events"] = [];
  child.on("message", (m) => events.push(m as Instance["events"][number]));
  const exited = new Promise<number | null>((resolve) => child.once("exit", (code) => resolve(code)));
  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 60_000;
  while (!events.some((e) => e.ev === "listening")) {
    if (child.exitCode !== null) throw new Error(`${name} exited ${child.exitCode}; see ${logFile}`);
    if (Date.now() > deadline) throw new Error(`${name} never listened; see ${logFile}`);
    await sleep(100);
  }
  while ((await fetch(`${url}/health`).then((r) => r.status, () => 0)) !== 200) await sleep(100);
  return { name, port, url, child, events, logFile, exited };
}

export async function killInstance(i: Instance) {
  if (i.child.exitCode !== null || i.child.signalCode !== null) return;
  i.child.kill("SIGKILL");
  await i.exited;
}

/**
 * Waits until the tap has heard `uids` adapters' heartbeats: the positive control every count on
 * the tap rests on, since a tap on the wrong channel would otherwise report zeros.
 */
export async function waitForPeers(tap: NotifyTap | RedisTap, uids = 2, ms = 15_000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const seen = tap instanceof RedisTap ? tap.heartbeatUids() : new Set(tap.msgs.filter((m) => m.type === 1 || m.type === 2).map((m) => m.uid));
    if (seen.size >= uids) {
      await sleep(1_000);
      return;
    }
    await sleep(200);
  }
  throw new Error("instances never heard each other's heartbeat");
}

// ── accounts and sockets ────────────────────────────────────────────────────

export async function register(url: string, username: string): Promise<{ cookie: string; id: string }> {
  const res = await fetch(`${url}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password: "repro-password-1", email: `${username.toLowerCase()}@example.test` }),
  });
  const text = await res.text();
  if (res.status !== 202) throw new Error(`register ${username}: ${res.status} ${text}`);
  const cookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  const me = await fetch(`${url}/api/auth/me`, { headers: { cookie } });
  return { cookie, id: (JSON.parse(await me.text()) as { id: string }).id };
}

export async function ticket(url: string, cookie: string): Promise<string> {
  const res = await fetch(`${url}/api/auth/socket-ticket`, { method: "POST", headers: { cookie } });
  const text = await res.text();
  if (res.status !== 200) throw new Error(`ticket: ${res.status} ${text}`);
  return (JSON.parse(text) as { ticket: string }).ticket;
}

export type Client = Socket;

/**
 * `web`: what lib/socket.ts does in a browser on the same origin — the upgrade carries the session
 * cookie and mints no ticket. `native`: a freshly minted ticket alone.
 */
export async function connect(url: string, cookie: string, how: "web" | "native" = "web"): Promise<Client> {
  const auth = how === "web" ? { protocolVersion: PROTOCOL_VERSION } : { ticket: await ticket(url, cookie), protocolVersion: PROTOCOL_VERSION };
  const socket = ioClient(url, {
    auth,
    extraHeaders: how === "web" ? { cookie } : {},
    transports: ["websocket"],
    reconnection: false,
    forceNew: true,
  });
  return new Promise((resolve, reject) => {
    socket.once("connect", () => resolve(socket));
    socket.once("connect_error", (e) => {
      socket.close();
      reject(e);
    });
  });
}

export function once<T = unknown>(socket: Client, event: string, ms = 10_000): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      socket.off(event, on);
      resolve(null);
    }, ms);
    const on = (p: T) => {
      clearTimeout(timer);
      resolve(p);
    };
    socket.once(event, on);
  });
}

// ── the NOTIFY tap ──────────────────────────────────────────────────────────

export const MSG = {
  1: "INITIAL_HEARTBEAT", 2: "HEARTBEAT", 3: "BROADCAST", 4: "SOCKETS_JOIN", 5: "SOCKETS_LEAVE",
  6: "DISCONNECT_SOCKETS", 7: "FETCH_SOCKETS", 8: "FETCH_SOCKETS_RESPONSE", 9: "SERVER_SIDE_EMIT",
  10: "SERVER_SIDE_EMIT_RESPONSE", 11: "BROADCAST_CLIENT_COUNT", 12: "BROADCAST_ACK", 13: "ADAPTER_CLOSE",
} as Record<number, string>;

export interface Tapped {
  t: number;
  type: number;
  uid: string;
  notifyBytes: number;
  attachmentId?: number;
  attachmentBytes?: number;
  msg?: Record<string, unknown>;
}

/** Every adapter message on the database's channel, attachments fetched and decoded on arrival. */
export class NotifyTap {
  msgs: Tapped[] = [];
  client = new pg.Client({ connectionString: `${DB_URL}?application_name=tap` });
  reader = new pg.Pool({ connectionString: `${DB_URL}?application_name=tapreader`, max: 2 });
  pending = new Set<Promise<unknown>>();
  async start(channel = "socket.io#/") {
    await this.client.connect();
    this.client.on("notification", (n) => {
      const raw = n.payload ?? "";
      const m = JSON.parse(raw) as Record<string, unknown>;
      const rec: Tapped = { t: Date.now(), type: m.type as number, uid: m.uid as string, notifyBytes: Buffer.byteLength(raw) };
      this.msgs.push(rec);
      if (m.attachmentId) {
        rec.attachmentId = Number(m.attachmentId);
        const p = this.reader
          .query("SELECT payload, octet_length(payload) AS n FROM socket_io_attachments WHERE id = $1", [m.attachmentId])
          .then((r) => {
            const row = r.rows[0] as { payload: Buffer; n: number } | undefined;
            if (!row) return;
            rec.attachmentBytes = row.n;
            rec.msg = decode(row.payload) as Record<string, unknown>;
          })
          .catch(() => {});
        this.pending.add(p);
        void p.finally(() => this.pending.delete(p));
      } else rec.msg = m;
    });
    await this.client.query(`LISTEN "${channel}"`);
    const deadline = Date.now() + 12_000;
    while (this.msgs.length === 0 && Date.now() < deadline) await sleep(200);
    if (this.msgs.length === 0) {
      await this.stop();
      throw new Error(`NotifyTap: nothing on Postgres channel "${channel}" in 12 s: the cluster no longer runs over it; use RedisTap`);
    }
  }
  async settle() {
    await sleep(300);
    await Promise.allSettled([...this.pending]);
  }
  mark() {
    return this.msgs.length;
  }
  since(mark: number, includeHeartbeats = false) {
    return this.msgs.slice(mark).filter((m) => includeHeartbeats || (m.type !== 1 && m.type !== 2));
  }
  async stop() {
    await this.client.end().catch(() => {});
    await this.reader.end().catch(() => {});
  }
}

export function summarise(msgs: Tapped[]) {
  const by: Record<string, { n: number; bytes: number; attachments: number; attachmentBytes: number }> = {};
  for (const m of msgs) {
    const k = MSG[m.type] ?? String(m.type);
    by[k] ??= { n: 0, bytes: 0, attachments: 0, attachmentBytes: 0 };
    by[k].n += 1;
    by[k].bytes += m.notifyBytes;
    if (m.attachmentId) {
      by[k].attachments += 1;
      by[k].attachmentBytes += m.attachmentBytes ?? 0;
    }
  }
  return by;
}

// ── the shared statement log, read by PID ───────────────────────────────────

/** PIDs of this database's backends, sampled until stop(); the log names a backend only by PID. */
export class PidWatch {
  pids = new Set<number>();
  #timer: ReturnType<typeof setInterval> | undefined;
  async sample() {
    const rows = await q<{ pid: number }>(
      "SELECT pid FROM pg_stat_activity WHERE datname = $1 AND application_name LIKE 'srv%'",
      [DB]
    );
    for (const r of rows) this.pids.add(r.pid);
  }
  start(everyMs = 100) {
    this.#timer = setInterval(() => void this.sample().catch(() => {}), everyMs);
    return this.sample();
  }
  async stop() {
    clearInterval(this.#timer);
    await this.sample();
  }
}

export const logOffset = () => fs.statSync(PG_LOG).size;

export interface LogStatement {
  pid: number;
  ts: string;
  sql: string;
  params?: string;
}

/** Statements (and their DETAIL parameter lines) written since `offset` by `pids`. */
export function readStatements(offset: number, pids: Set<number>): LogStatement[] {
  const fd = fs.openSync(PG_LOG, "r");
  const size = fs.fstatSync(fd).size;
  const buf = Buffer.alloc(size - offset);
  fs.readSync(fd, buf, 0, buf.length, offset);
  fs.closeSync(fd);
  const lines = buf.toString("utf8").split(/\r?\n/);
  const out: LogStatement[] = [];
  let last: LogStatement | null = null;
  for (const line of lines) {
    const m = /^(\S+ \S+ \S+) \[(\d+)\] (LOG|DETAIL|STATEMENT|ERROR):\s+(.*)$/.exec(line);
    if (!m) {
      if (last && line.startsWith("\t")) last.sql += " " + line.trim();
      continue;
    }
    const pid = Number(m[2]);
    if (!pids.has(pid)) {
      last = null;
      continue;
    }
    const body = m[4];
    if (m[3] === "LOG") {
      const s = /^(?:statement|execute [^:]*):\s+(.*)$/.exec(body);
      if (s) {
        last = { pid, ts: m[1], sql: s[1] };
        out.push(last);
      } else last = null;
    } else if (m[3] === "DETAIL" && last && body.startsWith("Parameters:")) {
      last.params = body;
    }
  }
  return out;
}

/** Literals stripped, so statements group by shape. */
export function shapeOf(sql: string) {
  return sql
    .replace(/'[^']*'/g, "'?'")
    .replace(/\$\d+/g, "$n")
    .replace(/\b\d+\b/g, "N")
    .replace(/\s+/g, " ")
    .slice(0, 110);
}

export function countShapes(stmts: LogStatement[]) {
  const counts = new Map<string, number>();
  for (const s of stmts) counts.set(shapeOf(s.sql), (counts.get(shapeOf(s.sql)) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]);
}

// ── a TCP proxy between one instance and Postgres ───────────────────────────

interface Pair {
  id: number;
  at: number;
  down: net.Socket;
  up: net.Socket;
  sawListen: boolean;
  stalled: boolean;
  delayMs: () => number;
  heldUp: Buffer[];
  heldDown: Buffer[];
}

/**
 * Forwards to Postgres. `stall(pair)` stops forwarding both ways without closing either socket, so
 * the client sees a connection that is open at TCP level and silent. `delay` adds per-chunk latency
 * that keeps each connection's byte order.
 */
export class PgProxy {
  targetPort: number;
  constructor(targetPort: number = PG_PORT) {
    this.targetPort = targetPort;
  }
  pairs: Pair[] = [];
  server = net.createServer((down) => this.#accept(down));
  delayFor: () => number = () => 0;
  #next = 0;
  listen(port: number) {
    return new Promise<void>((resolve) => this.server.listen(port, "127.0.0.1", resolve));
  }
  #accept(down: net.Socket) {
    const up = net.connect(this.targetPort, "127.0.0.1");
    const pair: Pair = { id: ++this.#next, at: Date.now(), down, up, sawListen: false, stalled: false, delayMs: () => this.delayFor(), heldUp: [], heldDown: [] };
    this.pairs.push(pair);
    const pipe = (from: net.Socket, to: net.Socket, held: Buffer[], dir: "up" | "down") => {
      let chain = Promise.resolve();
      from.on("data", (chunk: Buffer) => {
        if (dir === "up" && chunk.includes(Buffer.from('LISTEN "'))) pair.sawListen = true;
        if (pair.stalled) {
          held.push(chunk);
          return;
        }
        const d = pair.delayMs();
        chain = chain.then(async () => {
          if (d > 0) await sleep(d);
          if (pair.stalled) held.push(chunk);
          else to.write(chunk);
        });
      });
    };
    pipe(down, up, pair.heldUp, "up");
    pipe(up, down, pair.heldDown, "down");
    const end = () => {
      down.destroy();
      up.destroy();
    };
    down.on("error", end);
    up.on("error", end);
    down.on("close", () => up.destroy());
    up.on("close", () => down.destroy());
  }
  listenPairs() {
    return this.pairs.filter((p) => p.sawListen && !p.down.destroyed);
  }
  stall(pair: Pair) {
    pair.stalled = true;
  }
  close() {
    for (const p of this.pairs) {
      p.down.destroy();
      p.up.destroy();
    }
    return new Promise<void>((resolve) => this.server.close(() => resolve()));
  }
}

// ── the Redis tap ───────────────────────────────────────────────────────────

/** What the tap heard: one pub/sub message, or one entry of the adapter stream or of an inbox. */
export interface Heard {
  t: number;
  via: "pubsub" | "stream" | "inbox";
  key: string;
  /** The adapter's MessageType name, or the inbox message's `kind`. */
  type: string;
  /** SERVER_SIDE_EMIT's event name, when there is one. */
  event?: string;
  uid?: string;
  bytes: number;
  /** Everything the message carried, decoded to text, for the credential scan. */
  text: string;
  entryId?: string;
  msg?: Record<string, unknown>;
}

const HEARTBEAT_EVENT = "murlan:adapter-heartbeat";

function decodeData(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    try {
      return decode(Buffer.from(raw, "base64"));
    } catch {
      return raw;
    }
  }
}

/** JSON that survives the Buffers and Uint8Arrays msgpack hands back. */
const textOf = (v: unknown) =>
  JSON.stringify(v, (_k, x) => (x instanceof Uint8Array ? Buffer.from(x).toString("utf8") : typeof x === "bigint" ? String(x) : x));

/**
 * Every message the cluster puts on the store, the Redis-era counterpart of NotifyTap: the
 * adapter's pub/sub (public and private channels, where FETCH_SOCKETS, server-side emits and
 * every response travel), the adapter stream (room broadcasts) and every instance's inbox stream
 * (addressed state, forwarded intents, hand-offs). Streams are read from the tap's start, so an
 * inbox made after it is read whole.
 */
export class RedisTap {
  heard: Heard[] = [];
  sub = createClient({ url: REDIS_URL, name: "repro-tap-sub" });
  reader = createClient({ url: REDIS_URL, name: "repro-tap-reader" });
  cmd = createClient({ url: REDIS_URL, name: "repro-tap-cmd" });
  #from = `${Date.now()}-0`;
  #at = new Map<string, string>();
  #running = false;
  #loop: Promise<void> | null = null;

  async start() {
    for (const c of [this.sub, this.reader, this.cmd]) c.on("error", () => {});
    await Promise.all([this.sub.connect(), this.reader.connect(), this.cmd.connect()]);
    await this.sub.pSubscribe(
      `${KEYSPACE}:socket.io#*`,
      (message: Buffer, channel: Buffer | string) => this.#onPubsub(String(channel), message),
      true
    );
    this.#running = true;
    this.#loop = this.#read();
  }

  #onPubsub(channel: string, payload: Buffer) {
    let m: Record<string, unknown>;
    try {
      m = decode(payload) as Record<string, unknown>;
    } catch {
      return;
    }
    const type = MSG[m.type as number] ?? String(m.type);
    const data = m.data as { packet?: unknown[] } | undefined;
    const event = type === "SERVER_SIDE_EMIT" && typeof data?.packet?.[0] === "string" ? (data.packet[0] as string) : undefined;
    this.heard.push({ t: Date.now(), via: "pubsub", key: channel, type, event, uid: m.uid as string | undefined, bytes: payload.length, text: textOf(m), msg: m });
  }

  async #streams(): Promise<string[]> {
    const keys: string[] = [];
    for (const match of [`${KEYSPACE}:socket.io*`, `${KEYSPACE}:inbox:*`]) {
      for await (const batch of this.cmd.scanIterator({ MATCH: match, COUNT: 500, TYPE: "stream" })) keys.push(...batch);
    }
    return keys;
  }

  async #read() {
    let keys: string[] = [];
    let listedAt = 0;
    while (this.#running) {
      try {
        if (Date.now() - listedAt > 250) {
          keys = await this.#streams();
          listedAt = Date.now();
        }
        if (keys.length === 0) {
          await sleep(100);
          continue;
        }
        const reply = (await this.reader.xRead(
          keys.map((key) => ({ key, id: this.#at.get(key) ?? this.#from })),
          { BLOCK: 200, COUNT: 1000 }
        )) as { name: string; messages: { id: string; message: Record<string, string> }[] }[] | null;
        for (const { name, messages } of reply ?? []) {
          for (const entry of messages) {
            this.#at.set(name, entry.id);
            this.#onEntry(name, entry.id, entry.message);
          }
        }
      } catch {
        if (this.#running) await sleep(100);
      }
    }
  }

  #onEntry(key: string, entryId: string, fields: Record<string, string>) {
    const bytes = Object.entries(fields).reduce((a, [k, v]) => a + Buffer.byteLength(k) + Buffer.byteLength(v), 0);
    if (key.includes(":inbox:")) {
      let m: Record<string, unknown> = {};
      try {
        m = JSON.parse(fields.m ?? "{}") as Record<string, unknown>;
      } catch {}
      this.heard.push({ t: Date.now(), via: "inbox", key, type: String(m.kind ?? "?"), bytes, text: fields.m ?? "", entryId, msg: m });
      return;
    }
    const data = decodeData(fields.data);
    const type = MSG[Number(fields.type)] ?? String(fields.type);
    const msg = { uid: fields.uid, nsp: fields.nsp, type: Number(fields.type), data } as Record<string, unknown>;
    this.heard.push({ t: Date.now(), via: "stream", key, type, uid: fields.uid, bytes, text: textOf(msg), entryId, msg });
  }

  heartbeatUids(): Set<string> {
    return new Set(this.heard.filter((h) => h.event === HEARTBEAT_EVENT && h.uid).map((h) => h.uid!));
  }

  /** The inboxes whose own boot entry the tap read: the inbox half of the positive control. */
  bootedInboxes(): Set<string> {
    return new Set(this.heard.filter((h) => h.via === "inbox" && h.type === "boot").map((h) => h.key));
  }

  mark() {
    return this.heard.length;
  }

  /** What arrived since `mark`, less heartbeats and inbox boot entries. */
  since(mark: number) {
    return this.heard.slice(mark).filter((h) => h.event !== HEARTBEAT_EVENT && h.type !== "boot");
  }

  async settle(ms = 600) {
    await sleep(ms);
  }

  async stop() {
    this.#running = false;
    await this.#loop?.catch(() => {});
    for (const c of [this.sub, this.reader, this.cmd]) await c.destroy?.();
  }
}

export function tally(heard: Heard[]) {
  const by: Record<string, { n: number; bytes: number }> = {};
  for (const h of heard) {
    const k = `${h.via}:${h.type}${h.event ? `(${h.event})` : ""}`;
    by[k] ??= { n: 0, bytes: 0 };
    by[k].n += 1;
    by[k].bytes += h.bytes;
  }
  return by;
}

/** The session id inside a `connect.sid=s%3A<sid>.<signature>` cookie. */
export const sidOf = (cookie: string) => decodeURIComponent(/connect\.sid=([^;]+)/.exec(cookie)?.[1] ?? "").replace(/^s:/, "").split(".")[0] ?? "";

/** Where any of `secrets` appears: every key and value in the store's keyspace, every stream entry the tap heard. */
export async function secretsInStore(tap: RedisTap, secrets: string[]): Promise<string[]> {
  const found: string[] = [];
  const hit = (where: string, text: string) => {
    for (const s of secrets) if (s && text.includes(s)) found.push(where);
  };
  for (const h of tap.heard) hit(`${h.via} ${h.type} ${h.key}`, h.text);
  for await (const batch of tap.cmd.scanIterator({ MATCH: "*", COUNT: 500 })) {
    for (const key of batch) {
      const type = await tap.cmd.type(key);
      let text = key;
      if (type === "string") text += await tap.cmd.get(key);
      else if (type === "hash") text += JSON.stringify(await tap.cmd.hGetAll(key));
      else if (type === "set") text += JSON.stringify(await tap.cmd.sMembers(key));
      else if (type === "zset") text += JSON.stringify(await tap.cmd.zRange(key, 0, -1));
      else if (type === "list") text += JSON.stringify(await tap.cmd.lRange(key, 0, -1));
      else if (type === "stream") text += textOf(await tap.cmd.xRange(key, "-", "+"));
      hit(`key ${key} (${type})`, text);
    }
  }
  return found;
}

/** Where any of `secrets` appears in a text or json column of any table but `except`. */
export async function secretsInTables(secrets: string[], except: string[] = []): Promise<string[]> {
  const cols = await q<{ t: string; c: string }>(
    `SELECT table_name t, column_name c FROM information_schema.columns
      WHERE table_schema = 'public' AND data_type IN ('text', 'character varying', 'json', 'jsonb', 'bytea')`
  );
  const found: string[] = [];
  for (const { t, c } of cols) {
    if (except.includes(t)) continue;
    for (const s of secrets) {
      if (!s) continue;
      const [{ n }] = await q<{ n: number }>(`SELECT count(*)::int n FROM "${t}" WHERE position($1 in "${c}"::text) > 0`, [s]);
      if (n > 0) found.push(`${t}.${c} (${n} rows)`);
    }
  }
  return found;
}

// ── metrics ─────────────────────────────────────────────────────────────────

/** `/metrics` as name -> samples, read with the instances' METRICS_TOKEN when one is set. */
export async function scrapeMetrics(url: string, token = METRICS_TOKEN): Promise<Map<string, string[]>> {
  const res = await fetch(`${url}/metrics`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  if (res.status !== 200) throw new Error(`/metrics answered ${res.status}`);
  const out = new Map<string, string[]>();
  for (const line of (await res.text()).split("\n")) {
    const declared = /^# TYPE ([a-zA-Z_:][a-zA-Z0-9_:]*)/.exec(line)?.[1];
    if (declared) {
      if (!out.has(declared)) out.set(declared, []);
      continue;
    }
    if (!line || line.startsWith("#")) continue;
    const name = /^[a-zA-Z_:][a-zA-Z0-9_:]*/.exec(line)?.[0];
    if (!name) continue;
    const base = name.replace(/_(bucket|sum|count|total)$/, "");
    for (const k of new Set([name, base])) out.set(k, [...(out.get(k) ?? []), line]);
  }
  return out;
}

// ── output ──────────────────────────────────────────────────────────────────

export function out(file: string) {
  const lines: string[] = [];
  const log = (...parts: unknown[]) => {
    const line = parts.map((p) => (typeof p === "string" ? p : JSON.stringify(p))).join(" ");
    lines.push(line);
    console.log(line);
  };
  const save = () => fs.writeFileSync(path.join(SCRATCH, file), lines.join("\n") + "\n");
  return { log, save, lines };
}

/** Replaces credential-looking values before anything is printed. */
export function redact(s: string): string {
  return s
    .replace(/(connect\.sid=s%3A)[^;"\s]+/g, "$1<REDACTED>")
    .replace(/("ticket"\s*:\s*")[^"]+/g, "$1<REDACTED>")
    .replace(/("sid"\s*:\s*")[^"]+/g, "$1<REDACTED>");
}
