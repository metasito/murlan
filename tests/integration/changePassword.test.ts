// tests/integration/changePassword.test.ts — the in-app change-password
// screen's endpoint. A live session alone must not be enough to write a new
// credential, and a successful change must evict every other session for the
// account while leaving the one the request arrived on alive.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { startTestServer, hasDatabase, skipMessage, type TestServer } from "../helpers/testServer.ts";
import { register } from "../helpers/client.ts";

describe("in-app change password", { skip: hasDatabase() ? false : skipMessage() }, () => {
  let server: TestServer;
  before(async () => { server = await startTestServer(); });
  after(async () => { if (server) await server.stop(); });

  function login(username: string, password: string) {
    return fetch(`${server.url}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
  }

  function changePassword(cookie: string, currentPassword: string, newPassword: string) {
    return fetch(`${server.url}/api/auth/change-password`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
  }

  function me(cookie: string) {
    return fetch(`${server.url}/api/auth/me`, { headers: { cookie } });
  }

  /**
   * Two independent sessions for the same account, the way two devices would
   * hold them: `register()`'s cookie is one, and a second `login()` sent with
   * no cookie of its own regenerates a second, unrelated session id rather
   * than reusing or destroying the first.
   */
  async function twoSessions(username: string) {
    const { cookie: deviceA } = await register(server, username);
    const res = await login(username, "password123");
    const text = await res.text();
    assert.equal(res.status, 200, text);
    const deviceB = res.headers.get("set-cookie");
    assert.ok(deviceB, "second login must set its own session cookie");
    return { deviceA, deviceB: deviceB! };
  }

  test("the correct current password changes it, evicts every other session, and keeps the current one", async () => {
    const username = "change_pw_ok";
    const { deviceA, deviceB } = await twoSessions(username);

    const res = await changePassword(deviceB, "password123", "new-password-456");
    const text = await res.text();
    assert.equal(res.status, 200, text);

    // The session the change came from is still good.
    const stillIn = await me(deviceB);
    assert.equal(stillIn.status, 200, await stillIn.text());

    // Every other session for the account is gone.
    const loggedOut = await me(deviceA);
    assert.equal(loggedOut.status, 401, "a session other than the one the change arrived on must be cleared");

    // The password itself was actually written.
    const withNew = await login(username, "new-password-456");
    assert.equal(withNew.status, 200, await withNew.text());
    const withOld = await login(username, "password123");
    assert.equal(withOld.status, 401);
  });

  test("a wrong current password changes nothing and leaves every session intact", async () => {
    const username = "change_pw_wrong";
    const { deviceA, deviceB } = await twoSessions(username);

    const res = await changePassword(deviceB, "not-the-real-password", "new-password-456");
    const body = await res.json();
    assert.equal(res.status, 401);
    // Generic, indistinguishable from a wrong login — never a dedicated code.
    assert.deepEqual(body, { message: "Wrong username or password", code: "INVALID_CREDENTIALS" });

    // Neither session was touched by the refused attempt.
    assert.equal((await me(deviceA)).status, 200, "an unrelated session must survive a refused change");
    assert.equal((await me(deviceB)).status, 200, "the requesting session must survive a refused change");

    // The password itself is unchanged.
    const withOld = await login(username, "password123");
    assert.equal(withOld.status, 200, await withOld.text());
    const withAttempted = await login(username, "new-password-456");
    assert.equal(withAttempted.status, 401);
  });

  test("an unauthenticated request is refused", async () => {
    const res = await fetch(`${server.url}/api/auth/change-password`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ currentPassword: "password123", newPassword: "new-password-456" }),
    });
    assert.equal(res.status, 401);
  });
});
