import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Server } from "socket.io";
import { io as ioClient, type Socket } from "socket.io-client";
import { evictOlderSessions } from "../../server/socketPresence.ts";
import { userRoom } from "../../server/gameRoom.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("an eviction closes only the account's sockets older than the one it keeps", async () => {
  const http = createServer();
  const io = new Server(http);
  io.on("connection", (s) => void s.join(userRoom("u1")));
  await new Promise<void>((r) => http.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  const connect = () =>
    new Promise<Socket>((resolve) => {
      const s = ioClient(url, { transports: ["websocket"], reconnection: false });
      s.once("connect", () => resolve(s));
    });
  const eviction = (keep: Socket) => ({
    userId: "u1",
    keepSocketId: keep.id!,
    connectedAt: io.sockets.sockets.get(keep.id!)!.handshake.issued,
  });

  try {
    const older = await connect();
    await sleep(5);
    const newer = await connect();
    const olderId = older.id!;
    const newerId = newer.id!;

    // Another instance's broadcast for `older`, delivered after `newer` arrived.
    evictOlderSessions(io, eviction(older));
    assert.ok(io.sockets.sockets.has(newerId), "a late eviction closed the newer socket");
    assert.ok(io.sockets.sockets.has(olderId));

    const told = new Promise<string>((r) => older.once("socket:error", (p: { code: string }) => r(p.code)));
    evictOlderSessions(io, eviction(newer));
    assert.ok(!io.sockets.sockets.has(olderId), "the older socket survived its replacement");
    assert.ok(io.sockets.sockets.has(newerId));
    assert.equal(await told, "SESSION_REPLACED");
    newer.close();
  } finally {
    await io.close();
  }
});

test("two instances' evictions stamped in the same millisecond close exactly one socket", async () => {
  const http = createServer();
  const io = new Server(http);
  io.on("connection", (s) => void s.join(userRoom("u1")));
  await new Promise<void>((r) => http.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  try {
    const local = await new Promise<Socket>((resolve) => {
      const s = ioClient(url, { transports: ["websocket"], reconnection: false });
      s.once("connect", () => resolve(s));
    });
    const id = local.id!;
    const connectedAt = io.sockets.sockets.get(id)!.handshake.issued;

    evictOlderSessions(io, { userId: "u1", keepSocketId: "", connectedAt });
    assert.ok(io.sockets.sockets.has(id), "the tie was lost by both sockets");
    evictOlderSessions(io, { userId: "u1", keepSocketId: "￿", connectedAt });
    assert.ok(!io.sockets.sockets.has(id), "the tie was won by both sockets");
  } finally {
    await io.close();
  }
});
