// Shared harness for the server-side reproductions: boots real server processes (instance.ts)
// against murlan_repro_srv, registers users, opens sockets the way the web and native clients do,
// taps every Socket.IO adapter NOTIFY, and reads the shared Postgres statement log by PID.
import pg from "pg";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { io as ioClient, type Socket } from "socket.io-client";
import { decode } from "@msgpack/msgpack";
import { PROTOCOL_VERSION } from "../../../../../../shared/protocol.ts";

export const ROOT = path.resolve(import.meta.dirname, "../../../../../..");
export const SRV = import.meta.dirname;
export const RESULTS = path.resolve(ROOT, "docs/research/2026-11-01-system-audit/sim/results");
export const SCRATCH =
  "C:/Users/roton/AppData/Local/Temp/claude/C--Users-roton-murlan--claude-worktrees-archify-installation-6691b3/43894df7-2800-4ae1-aa9c-03a933e4e653/scratchpad/srv";
export const PG_LOG =
  "C:/Users/roton/AppData/Local/Temp/claude/C--Users-roton-murlan--claude-worktrees-archify-installation-6691b3/43894df7-2800-4ae1-aa9c-03a933e4e653/scratchpad/pg.log";
export const DB = "murlan_repro_srv";
export const PG_PORT = 55432;
export const DB_URL = `postgres://postgres@localhost:${PG_PORT}/${DB}`;
fs.mkdirSync(SCRATCH, { recursive: true });

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const admin = new pg.Pool({ connectionString: `${DB_URL}?application_name=harness`, max: 3 });
export const q = async <R = Record<string, unknown>>(sql: string, params?: unknown[]) =>
  (await admin.query(sql, params)).rows as R[];

/** Rows the app writes, emptied between experiments; the schema stays. */
export async function resetData() {
  await q(`TRUNCATE users, auth_tokens, bug_reports, client_errors, events, friends, rooms, game_invites,
    push_tokens, room_players, round_history, round_replays, server_errors, socket_io_attachments,
    socket_ticket_nonces, user_achievements, user_ratings, user_stats, session, active_games CASCADE`);
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
  { env = {}, dbUrl = DB_URL }: { env?: Record<string, string>; dbUrl?: string } = {}
): Promise<Instance> {
  const logFile = path.join(SCRATCH, `${name}-${Date.now()}.log`);
  const fd = fs.openSync(logFile, "w");
  const child = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", path.join(SRV, "instance.ts")], {
    cwd: ROOT,
    env: {
      ...process.env,
      DATABASE_URL: `${dbUrl}?application_name=${name}`,
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

/** Waits until each instance's adapter has heard the other's heartbeat (5 s interval). */
export async function waitForPeers(tap: NotifyTap, uids = 2, ms = 15_000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const seen = new Set(tap.msgs.filter((m) => m.type === 1 || m.type === 2).map((m) => m.uid));
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
 * cookie, and `auth` still carries a freshly minted ticket. `native`: the ticket alone.
 */
export async function connect(url: string, cookie: string, how: "web" | "native" = "web"): Promise<Client> {
  const t = await ticket(url, cookie);
  const socket = ioClient(url, {
    auth: { ticket: t, protocolVersion: PROTOCOL_VERSION },
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
  #timer: NodeJS.Timeout | undefined;
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
  pairs: Pair[] = [];
  server = net.createServer((down) => this.#accept(down));
  delayFor: () => number = () => 0;
  #next = 0;
  listen(port: number) {
    return new Promise<void>((resolve) => this.server.listen(port, "127.0.0.1", resolve));
  }
  #accept(down: net.Socket) {
    const up = net.connect(PG_PORT, "127.0.0.1");
    const pair: Pair = { id: ++this.#next, down, up, sawListen: false, stalled: false, delayMs: () => this.delayFor(), heldUp: [], heldDown: [] };
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
