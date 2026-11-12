// tests/integration/adapterQuietStream.test.ts — a broadcast reaches a peer whatever its read was
// doing when the broadcast was appended, on a stream nothing else is written to.
import { test, after, describe } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { createClient } from "redis";
import { Server } from "socket.io";
import { io as connect, type Socket as ClientSocket } from "socket.io-client";
import { eventually } from "../helpers/client.ts";
import { hasDatabase, skipMessage } from "../helpers/testServer.ts";
import { dropKeyspace } from "../helpers/redisKeys.ts";
import { startProxy, targetOf, viaProxy, type Proxy } from "../helpers/tcpProxy.ts";
import { createSocketAdapter } from "../../server/socket/socketAdapter.ts";
import { openPresenceStore, type PresenceStore } from "../../server/store/presence.ts";
import { BLOCK_MS, closeRedis, keyspace } from "../../server/store/redis.ts";

const baseUrl = process.env.DATABASE_URL ?? "";
const redisUrl = process.env.REDIS_URL ?? "";

describe("a broadcast on a quiet stream", { skip: hasDatabase() ? false : skipMessage() }, () => {
  const scoped = `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}options=-c%20search_path%3Dquiet_${Date.now()}`;
  const stream = `${keyspace(scoped)}:socket.io`;
  const probe = createClient({ url: redisUrl });
  probe.on("error", () => {});
  const servers: Server[] = [];
  const stores: PresenceStore[] = [];
  let proxy: Proxy | undefined;
  let client: ClientSocket | undefined;
  const http = createServer();

  function boot(name: string, through?: Proxy, io = new Server()): Server {
    process.env.DATABASE_URL = scoped;
    process.env.REDIS_URL = through ? viaProxy(redisUrl, through) : redisUrl;
    const presence = openPresenceStore({ id: `${name}-${randomUUID()}`, ns: keyspace(scoped) });
    stores.push(presence);
    io.adapter(createSocketAdapter(presence));
    process.env.DATABASE_URL = baseUrl;
    process.env.REDIS_URL = redisUrl;
    servers.push(io);
    return io;
  }

  after(async () => {
    client?.close();
    for (const io of servers) await io.of("/").adapter.close();
    if (http.listening) await new Promise<void>((r) => http.close(() => r()));
    for (const store of stores) store.close();
    await proxy?.close();
    probe.destroy();
    closeRedis();
    await dropKeyspace(scoped);
  });

  test("reaches a peer whose next read was on its way when it was appended", { timeout: 30_000 }, async () => {
    await probe.connect();
    let reads = 0;
    let release!: () => void;
    const secondRead = new Promise<void>((r) => (release = r));
    proxy = await startProxy(targetOf(redisUrl, 6379), {
      holdClientBytes: (chunk) => (chunk.includes("XREAD") && ++reads === 2 ? secondRead : undefined),
    });

    const reader = boot("reader", proxy, new Server(http, { transports: ["websocket"] }));
    const writer = boot("writer");
    await new Promise<void>((r) => http.listen(0, "127.0.0.1", r));
    client = connect(`http://127.0.0.1:${(http.address() as { port: number }).port}`, { transports: ["websocket"] });
    const received: unknown[] = [];
    client.on("state", (n: unknown) => received.push(n));
    await new Promise<void>((r) => client!.on("connect", () => r()));
    assert.equal(reader.sockets.sockets.size, 1);

    await eventually(() => reads === 2, "the reader's first read to come back empty and its second to be held", BLOCK_MS * 3);
    assert.equal(await probe.xLen(stream), 0, "something else wrote to the stream, so the reader's position is not the tail's");
    writer.emit("state", 1);
    await eventually(async () => (await probe.xLen(stream)) === 1, "the broadcast to be appended");
    release();

    await eventually(() => received.length === 1, "the broadcast to reach the reader's socket", BLOCK_MS * 3);
    assert.deepEqual(received, [1]);
  });
});
