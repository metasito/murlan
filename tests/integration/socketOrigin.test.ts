// Socket.IO's `cors` option only shapes headers on an HTTP polling handshake,
// and this server is websocket-only (server/socket/socket.ts) — so the allowlist has
// to be enforced by `allowRequest`, at the upgrade itself.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { openSocket, register } from "../helpers/client.ts";
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

  test("a browser on an origin nobody allowed is refused the upgrade", async () => {
    const attempt = await openSocket(server, { cookie, origin: "https://evil.example.com" });
    if (attempt.ok) attempt.socket.close();
    assert.equal(attempt.ok, false, "a foreign origin opened a socket");
  });

  test("a native client, which sends no Origin at all, still connects", async () => {
    const attempt = await openSocket(server, { cookie });
    assert.ok(attempt.ok, attempt.ok ? "" : attempt.err);
    attempt.socket.close();
  });

  test("an allowed origin still connects", async () => {
    const attempt = await openSocket(server, { cookie, origin: server.url });
    assert.ok(attempt.ok, attempt.ok ? "" : attempt.err);
    attempt.socket.close();
  });
});
