import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { startTestServer, hasDatabase, skipMessage, type TestServer } from "../helpers/testServer.ts";
import { register } from "../helpers/client.ts";

// "Tutorial already seen" has to follow the account, not the phone: AsyncStorage
// is cleared by a reinstall and does not exist on a second device, so a player
// who finished the tutorial months ago was offered it again everywhere else.

let server: TestServer;
before(async () => { if (hasDatabase()) server = await startTestServer(); });
after(async () => { if (server) await server.stop(); });

describe("the account remembers the tutorial", { skip: hasDatabase() ? false : skipMessage() }, () => {
  const me = async (cookie: string) => {
    const res = await fetch(`${server.url}/api/auth/me`, { headers: { cookie } });
    assert.equal(res.status, 200);
    return (await res.json()) as { tutorialSeenAt: string | null };
  };

  const markSeen = (cookie: string) =>
    fetch(`${server.url}/api/users/me/tutorial-seen`, { method: "POST", headers: { cookie } });

  test("a new account has never seen it", async () => {
    const { user, cookie } = await register(server, "tut_fresh");
    assert.equal((user as { tutorialSeenAt?: string | null }).tutorialSeenAt, null);
    assert.equal((await me(cookie)).tutorialSeenAt, null);
  });

  test("opening it once is remembered for every later device", async () => {
    const { cookie } = await register(server, "tut_opener");

    const res = await markSeen(cookie);
    assert.equal(res.status, 200);

    const seenAt = (await me(cookie)).tutorialSeenAt;
    assert.ok(seenAt, "the account must report when it opened the tutorial");
    assert.ok(!Number.isNaN(Date.parse(seenAt)), `not a date: ${seenAt}`);
  });

  test("opening it again keeps the first answer", async () => {
    // The question is "has it ever been offered", so the first date is the
    // true one — a second open must not move it.
    const { cookie } = await register(server, "tut_reopener");
    await markSeen(cookie);
    const first = (await me(cookie)).tutorialSeenAt;

    await markSeen(cookie);

    assert.equal((await me(cookie)).tutorialSeenAt, first);
  });

  test("a signed-out client cannot mark anything", async () => {
    const res = await fetch(`${server.url}/api/users/me/tutorial-seen`, { method: "POST" });
    assert.equal(res.status, 401);
  });
});
