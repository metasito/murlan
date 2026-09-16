import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { startTestServer, hasDatabase, skipMessage, type TestServer } from "../helpers/testServer.ts";
import { register } from "../helpers/client.ts";

type Account = Awaited<ReturnType<typeof register>>;

describe("a friend request is answered only by the account it concerns", { skip: hasDatabase() ? false : skipMessage() }, () => {
  let server: TestServer;
  let a: Account;
  let b: Account;
  let c: Account;

  before(async () => {
    server = await startTestServer();
    a = await register(server, "scope_sender");
    b = await register(server, "scope_recipient");
    c = await register(server, "scope_stranger");
  });
  after(async () => {
    await server?.stop();
  });

  const call = (who: Account, method: string, path: string, body?: unknown) =>
    fetch(`${server.url}${path}`, {
      method,
      headers: { cookie: who.cookie, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  async function request(from: Account, to: Account): Promise<string> {
    const add = await call(from, "POST", "/api/friends/add", { username: to.user.username });
    assert.equal(add.status, 200, await add.text());
    const rows = (await (await call(to, "GET", "/api/friends/requests")).json()) as {
      id: string;
      username: string;
    }[];
    const row = rows.find((r) => r.username === from.user.username);
    assert.ok(row, "the request never reached its recipient");
    return row.id;
  }

  const pendingFor = async (who: Account) =>
    ((await (await call(who, "GET", "/api/friends/requests")).json()) as { id: string }[]).map((r) => r.id);

  test("the sender, a stranger and the recipient each get only their own verb", async () => {
    const id = await request(a, b);

    assert.equal((await call(a, "POST", `/api/friends/accept/${id}`)).status, 404, "the sender accepted their own request");
    assert.equal((await call(a, "POST", `/api/friends/decline/${id}`)).status, 404, "the sender declined as the recipient");
    assert.equal((await call(c, "POST", `/api/friends/accept/${id}`)).status, 404, "a stranger accepted it");
    assert.equal((await call(c, "POST", `/api/friends/decline/${id}`)).status, 404, "a stranger declined it");
    assert.equal((await call(c, "DELETE", `/api/friends/requests/${id}`)).status, 404, "a stranger cancelled it");
    assert.equal((await call(b, "DELETE", `/api/friends/requests/${id}`)).status, 404, "the recipient cancelled as the sender");
    assert.deepEqual(await pendingFor(b), [id], "a refused call still removed the request");

    assert.equal((await call(b, "POST", `/api/friends/accept/${id}`)).status, 200);
    assert.deepEqual(await pendingFor(b), []);
  });

  test("the recipient may decline, and the sender may cancel", async () => {
    const declined = await request(c, b);
    assert.equal((await call(b, "POST", `/api/friends/decline/${declined}`)).status, 200);
    assert.deepEqual(await pendingFor(b), []);

    const cancelled = await request(a, c);
    assert.equal((await call(a, "DELETE", `/api/friends/requests/${cancelled}`)).status, 200);
    assert.deepEqual(await pendingFor(c), []);
  });
});
