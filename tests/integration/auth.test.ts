import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { startTestServer, hasDatabase, skipMessage, type TestServer } from "../helpers/testServer.ts";
import { register, connect as connectRaw } from "../helpers/client.ts";

describe("socket authentication", { skip: hasDatabase() ? false : skipMessage() }, () => {
  let server: TestServer;
  before(async () => { server = await startTestServer(); });
  after(async () => { await server.stop(); });

  // Local wrapper: this suite only cares about accept/reject, not the raw
  // socket, and always closes on success so sockets never leak across cases.
  async function connect(auth: Record<string, unknown>): Promise<{ ok: boolean; err?: string }> {
    const r = await connectRaw(server, auth);
    r.socket?.close();
    return { ok: r.ok, err: r.err };
  }

  test("a socket with no credentials is rejected", async () => {
    const r = await connect({});
    assert.equal(r.ok, false);
  });

  test("a bare userId is rejected — this was a full impersonation vector", async () => {
    const { user } = await register(server, "victim_a");
    const r = await connect({ userId: user.id });
    assert.equal(r.ok, false, "connecting with only a victim's userId must fail");
  });

  test("a valid ticket is accepted", async () => {
    const { cookie } = await register(server, "holder_a");
    const res = await fetch(`${server.url}/api/auth/socket-ticket`, { method: "POST", headers: { cookie } });
    assert.equal(res.status, 200);
    const { ticket } = await res.json();
    const r = await connect({ ticket });
    assert.equal(r.ok, true, r.err);
  });

  test("a ticket cannot be replayed", async () => {
    const { cookie } = await register(server, "holder_b");
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
