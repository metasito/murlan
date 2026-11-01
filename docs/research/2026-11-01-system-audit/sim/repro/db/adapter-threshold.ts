// Adapter threshold: the patched @socket.io/postgres-adapter sends a NOTIFY inline unless
// Buffer.byteLength(JSON.stringify(message)) > payloadThreshold (8000), while Postgres refuses a
// NOTIFY payload of 8000 bytes or more. Real socket.io Server on the real createSocketAdapter();
// io.emit() a string sized so the adapter's JSON payload is 7999, 8000 and 8001 bytes.
import { Server } from "socket.io";
import { directUrl, log } from "./proxy.ts";

process.env.DATABASE_URL = directUrl;
const { createSocketAdapter, socketAdapterPool, socketAdapterReady } = await import("../../../../../../server/socket/socketAdapter.ts");
const { logger } = await import("../../../../../../server/shared/logger.ts");

const io = new Server();
io.adapter(createSocketAdapter());
const pool = socketAdapterPool()!;
await socketAdapterReady().catch((e) => log("ready:", (e as Error).message));

const sent: { kind: string; bytes: number; err?: string }[] = [];
const orig = pool.query.bind(pool) as (...a: unknown[]) => Promise<unknown>;
(pool as unknown as { query: (...a: unknown[]) => Promise<unknown> }).query = (...a: unknown[]) => {
  const text = String(a[0]);
  const params = a[1] as unknown[] | undefined;
  const kind = text.includes("pg_notify") ? "pg_notify" : text.includes("INSERT INTO") ? "attachment insert" : "";
  if (!kind) return orig(...a);
  const rec = { kind, bytes: kind === "pg_notify" ? Buffer.byteLength(String(params![1])) : (params![0] as Buffer).length };
  sent.push(rec);
  return orig(...a).catch((e: Error) => { (rec as { err?: string }).err = e.message; throw e; });
};
const errors: string[] = [];
const origError = logger.error.bind(logger);
(logger as unknown as { error: (...a: unknown[]) => void }).error = (...a: unknown[]) => {
  const msg = typeof a[1] === "string" ? a[1] : String(a[0]);
  errors.push(msg);
  return (origError as (...x: unknown[]) => void)(...a);
};

const emitSized = async (len: number) => {
  sent.length = 0; errors.length = 0;
  io.emit("probe", "x".repeat(len));
  await new Promise((r) => setTimeout(r, 300));
  return sent.map((s) => `${s.kind} ${s.bytes} B${s.err ? ` -> ERROR ${s.err}` : " -> ok"}`).join("; ") +
    (errors.length ? ` | logged: ${errors.join(" / ")}` : "");
};

const first = await emitSized(7000);
const overhead = Number(first.match(/pg_notify (\d+) B/)![1]) - 7000;
log(`JSON envelope overhead around the emitted string: ${overhead} bytes`);
for (const target of [7999, 8000, 8001]) log(`payload ${target} B: ${await emitSized(target - overhead)}`);

io.close();
await pool.end().catch(() => {});
process.exit(0);
