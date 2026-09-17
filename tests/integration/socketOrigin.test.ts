// Socket.IO's `cors` option only shapes headers on an HTTP polling handshake,
// and this server is websocket-only (server/socket.ts) — so the allowlist has
// to be enforced by `allowRequest`, at the upgrade itself.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { io as ioClient, type Socket } from "socket.io-client";
import { PROTOCOL_AUTH, register } from "../helpers/client.ts";
import {
  startTestServer,
  hasDatabase,
  skipMessage,
  type TestServer,
} from "../helpers/testServer.ts";

describe("who may open a socket", { skip: hasDatabase() ? false : skipMessage() }, () => {
  let server: TestServer;
  let cookie: string;

  before(async () => {
    server = await startTestServer();
    ({ cookie } = await register(server, "origin_probe"));
  });

  after(async () => {
    await new Promise((resolve) => setTimeout(resolve, 600));
    await server.stop();
  });

  function connectFrom(origin?: string): Promise<{ ok: boolean; err?: string; socket?: Socket }> {
    return new Promise((resolve) => {
      const socket = ioClient(server.url, {
        transports: ["websocket"],
        auth: PROTOCOL_AUTH,
        extraHeaders: origin ? { cookie, origin } : { cookie },
        reconnection: false,
      });
      socket.on("connect", () => resolve({ ok: true, socket }));
      socket.on("connect_error", (err) => {
        socket.close();
        resolve({ ok: false, err: err.message });
      });
    });
  }

  test("a browser on an origin nobody allowed is refused the upgrade", async () => {
    const attempt = await connectFrom("https://evil.example.com");
    assert.equal(attempt.ok, false, "a foreign origin opened a socket");
    attempt.socket?.close();
  });

  test("a native client, which sends no Origin at all, still connects", async () => {
    const attempt = await connectFrom();
    assert.equal(attempt.ok, true, attempt.err);
    attempt.socket?.close();
  });

  test("an allowed origin still connects", async () => {
    const attempt = await connectFrom(server.url);
    assert.equal(attempt.ok, true, attempt.err);
    attempt.socket?.close();
  });
});
