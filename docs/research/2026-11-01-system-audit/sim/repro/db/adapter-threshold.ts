// Adapter threshold: the audit's patched @socket.io/postgres-adapter sent a NOTIFY inline unless
// the payload was > 8000 bytes, while Postgres refuses 8000 or more, so a broadcast of exactly
// 8000 bytes was lost to every other instance. D5 removed that adapter. This checks it is gone,
// and sends broadcasts of 7999, 8000, 8001 and 200,000 bytes between two real socket.io servers
// on the real createSocketAdapter() (Redis streams), counting what a client on the other one gets.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { Server } from "socket.io";
import { io as ioClient } from "socket.io-client";
import { directUrl, log } from "./proxy.ts";

process.env.DATABASE_URL = directUrl;
process.env.LOG_LEVEL = "silent";
if (!process.env.REDIS_URL) throw new Error("REDIS_URL is required: the adapter runs over Redis");
// The lockfile, not require.resolve: a worktree nested in another checkout resolves that one's node_modules too.
const lock = JSON.parse(readFileSync(new URL("../../../../../../package-lock.json", import.meta.url), "utf8")) as { packages: Record<string, unknown> };
const installed = Object.keys(lock.packages).some((k) => k.endsWith("node_modules/@socket.io/postgres-adapter"));
log(`@socket.io/postgres-adapter in package-lock.json: ${installed}`);

const { createSocketAdapter } = await import("../../../../../../server/socket/socketAdapter.ts");
const listen = async () => {
  const http = createServer();
  const io = new Server(http);
  io.adapter(createSocketAdapter({ livePeers: async () => 0, leave: () => {} }) as never);
  await new Promise<void>((r) => http.listen(0, "127.0.0.1", r));
  return { io, port: (http.address() as { port: number }).port };
};
const sender = await listen();
const receiver = await listen();
const client = ioClient(`http://127.0.0.1:${receiver.port}`, { transports: ["websocket"], forceNew: true });
await new Promise<void>((r) => client.once("connect", () => r()));
await new Promise((r) => setTimeout(r, 1_500));

const got: number[] = [];
client.on("probe", (s: string) => got.push(Buffer.byteLength(s)));
const sizes = [7999, 8000, 8001, 200_000];
const send = async (n: number) => {
  const before = got.length;
  sender.io.emit("probe", "x".repeat(n));
  const deadline = Date.now() + 3_000;
  while (got.length === before && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
  return got.length > before ? `delivered (${got.at(-1)} B)` : "LOST";
};
const controlBefore = got.length;
receiver.io.emit("probe", "x".repeat(10));
await new Promise((r) => setTimeout(r, 300));
if (got.length === controlBefore) throw new Error("positive control: a local emit on the receiver never reached its own client");
log("positive control, a local emit on the receiver reaches its own client: yes");
for (const n of sizes) log(`broadcast of a ${n} B string from the other server: ${await send(n)}`);

client.close();
sender.io.close();
receiver.io.close();
process.exit(0);
