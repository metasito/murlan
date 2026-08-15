import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { io as ioClient } from "socket.io-client";
import { startTestServer, hasDatabase, skipMessage, type TestServer } from "../helpers/testServer.ts";

describe("socket authentication", { skip: hasDatabase() ? false : skipMessage() }, () => {
  let server: TestServer;
  before(async () => { server = await startTestServer(); });
  after(async () => { await server.stop(); });

  async function register(username: string) {
    const res = await fetch(`${server.url}/api/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password: "password123" }),
    });
    // Read the body once as text: `assert.equal`'s message argument is
    // evaluated eagerly regardless of pass/fail, so `await res.text()`
    // inline as the third arg would consume the stream every time and
    // leave nothing for a later `res.json()` call.
    const text = await res.text();
    assert.equal(res.status, 200, text);
    return { user: JSON.parse(text), cookie: res.headers.get("set-cookie")! };
  }

  function connect(auth: Record<string, unknown>): Promise<{ ok: boolean; err?: string }> {
    return new Promise((resolve) => {
      const s = ioClient(server.url, { auth, transports: ["websocket"], reconnection: false });
      s.on("connect", () => { s.close(); resolve({ ok: true }); });
      s.on("connect_error", (e) => { s.close(); resolve({ ok: false, err: e.message }); });
    });
  }

  test("a socket with no credentials is rejected", async () => {
    const r = await connect({});
    assert.equal(r.ok, false);
  });

  test("a bare userId is rejected — this was a full impersonation vector", async () => {
    const { user } = await register("victim_a");
    const r = await connect({ userId: user.id });
    assert.equal(r.ok, false, "connecting with only a victim's userId must fail");
  });

  test("a valid ticket is accepted", async () => {
    const { cookie } = await register("holder_a");
    const res = await fetch(`${server.url}/api/auth/socket-ticket`, { method: "POST", headers: { cookie } });
    assert.equal(res.status, 200);
    const { ticket } = await res.json();
    const r = await connect({ ticket });
    assert.equal(r.ok, true, r.err);
  });

  test("a ticket cannot be replayed", async () => {
    const { cookie } = await register("holder_b");
    const res = await fetch(`${server.url}/api/auth/socket-ticket`, { method: "POST", headers: { cookie } });
    const { ticket } = await res.json();
    const first = await connect({ ticket });
    assert.equal(first.ok, true, first.err);
    const second = await connect({ ticket });
    assert.equal(second.ok, false, "a consumed ticket must not authenticate a second socket");
  });

  test("a forged ticket is rejected", async () => {
    const r = await connect({ ticket: "not.a.real.ticket" });
    assert.equal(r.ok, false);
  });
});
