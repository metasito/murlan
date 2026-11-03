// tests/integration/revokeWithoutRedis.test.ts — what an instance does on its own sockets does not
// wait on the cluster.
//
// With Redis unreachable, an instance cannot reach any other, but its own sockets are still its
// own: a logout must still cut them, and a friend connected here is still online.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { connectSocket, register, waitFor, waitForOrNull, type TestSocket } from "../helpers/client.ts";
import { hasDatabase, skipMessage, startTestServer, type TestServer } from "../helpers/testServer.ts";
import { startProxy, targetOf, viaProxy, type Proxy } from "../helpers/tcpProxy.ts";

describe("Redis unreachable", { skip: hasDatabase() ? false : skipMessage() }, () => {
  const redisUrl = process.env.REDIS_URL!;
  let proxy: Proxy;
  let server: TestServer;
  const sockets: TestSocket[] = [];

  before(async () => {
    proxy = await startProxy(targetOf(redisUrl, 6379));
    process.env.REDIS_URL = viaProxy(redisUrl, proxy);
    try {
      server = await startTestServer();
    } finally {
      process.env.REDIS_URL = redisUrl;
    }
  });

  after(async () => {
    for (const s of sockets) s.close();
    proxy.refuse(false);
    await server?.stop();
    await proxy?.close();
  });

  const tag = () => Date.now().toString(36).slice(-6);
  const post = (cookie: string, path: string, body?: unknown) =>
    fetch(`${server.url}${path}`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });

  test("a logout still cuts this instance's own socket", async () => {
    const { cookie } = await register(server, `rv${tag()}`);
    const socket = await connectSocket(server, { cookie });
    sockets.push(socket);
    proxy.refuse(true);
    try {
      const cut = waitForOrNull(socket, "disconnect", 6_000);
      assert.equal((await post(cookie, "/api/auth/logout")).status, 200);
      assert.notEqual(await cut, null, "the logged-out session's socket on this instance stayed live");
    } finally {
      proxy.refuse(false);
    }
  });

  test("a revocation retried once Redis is back spares a socket opened after it", { timeout: 420_000 }, async () => {
    const name = `rc${tag()}`;
    const { cookie } = await register(server, name);
    proxy.refuse(true);
    const changed = await post(cookie, "/api/auth/change-password", {
      currentPassword: "password123",
      newPassword: "newpassword456",
    });
    assert.equal(changed.status, 200, await changed.text());
    proxy.refuse(false);
    const login = await post("", "/api/auth/login", { username: name, password: "newpassword456" });
    assert.equal(login.status, 200, await login.text());
    const fresh = await connectSocket(server, { cookie: login.headers.get("set-cookie")! });
    sockets.push(fresh);
    // Past the last retry of the cluster pass the change-password failed.
    assert.equal(await waitForOrNull(fresh, "disconnect", 12_000), null, "a retried revocation cut a socket signed in after it");
  });

  test("a friend connected to this instance is still online", async () => {
    const a = await register(server, `fa${tag()}`);
    const b = await register(server, `fb${tag()}`);
    assert.equal((await post(a.cookie, "/api/friends/add", { username: b.user.username })).status, 200);
    const rows = (await (await fetch(`${server.url}/api/friends/requests`, { headers: { cookie: b.cookie } })).json()) as { id: string }[];
    assert.equal((await post(b.cookie, `/api/friends/accept/${rows[0]!.id}`)).status, 200);
    // Each connect's own push first, so the list read below is the answer to the ask made with Redis gone.
    const onA = await connectSocket(server, { cookie: a.cookie });
    await waitFor(onA, "friend:online_list");
    const onB = await connectSocket(server, { cookie: b.cookie });
    await waitFor(onB, "friend:online_list");
    sockets.push(onA, onB);

    proxy.refuse(true);
    try {
      const list = waitFor(onA, "friend:online_list");
      onA.emit("friend:get_online_list", {});
      assert.deepEqual((await list).onlineIds, [b.user.id], "a friend on this very instance read as offline");
    } finally {
      proxy.refuse(false);
    }
  });
});
