import { test } from "node:test";
import assert from "node:assert/strict";
import { hasDatabase, skipMessage, startTestServer } from "../helpers/testServer.ts";
import { register } from "../helpers/client.ts";

test("a second server boots in the process after the first one stops", { timeout: 60_000 }, async (t) => {
  if (!hasDatabase()) {
    t.skip(skipMessage());
    return;
  }

  const first = await startTestServer();
  await register(first, `first_${`${Date.now()}`.slice(-8)}`);
  await first.stop();

  const second = await startTestServer();
  try {
    const username = `second_${`${Date.now()}`.slice(-8)}`;
    const { cookie } = await register(second, username);
    const me = await fetch(`${second.url}/api/auth/me`, { headers: { cookie } });
    assert.equal(me.status, 200, "the second server's session store is not on a live pool");
    const rows = await second.query<{ username: string }>("SELECT username FROM users");
    assert.deepEqual(
      rows.map((r) => r.username),
      [username],
      "the second server is not on its own schema"
    );
  } finally {
    await second.stop();
  }
});
