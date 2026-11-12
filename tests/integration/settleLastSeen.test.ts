// tests/integration/settleLastSeen.test.ts — a departure a sweep reports without its time
// never overwrites the last_seen the account's own disconnect wrote.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { startTestServer, hasDatabase, skipMessage, type TestServer } from "../helpers/testServer.ts";
import { register } from "../helpers/client.ts";
import { userStore } from "../../server/store/userStore.ts";

describe("settleLastSeen", { skip: hasDatabase() ? false : skipMessage() }, () => {
  let server: TestServer;
  before(async () => { server = await startTestServer(); });
  after(async () => { if (server) await server.stop(); });

  test("keeps a last_seen written since the connect, and replaces an older one or none", async () => {
    const { user } = await register(server, "settle_seen");
    const since = new Date("2026-03-01T09:00:00.000Z");
    const now = new Date("2026-03-02T09:00:00.000Z");

    await userStore.updateLastSeen(user.id, new Date("2026-03-01T09:30:00.000Z"));
    assert.equal((await userStore.settleLastSeen(user.id, since, now))?.toISOString(), "2026-03-01T09:30:00.000Z");
    assert.equal((await userStore.getUser(user.id))?.lastSeen?.toISOString(), "2026-03-01T09:30:00.000Z");

    await userStore.updateLastSeen(user.id, new Date("2026-02-01T09:00:00.000Z"));
    assert.equal((await userStore.settleLastSeen(user.id, since, now))?.toISOString(), now.toISOString());
    assert.equal((await userStore.getUser(user.id))?.lastSeen?.toISOString(), now.toISOString());
  });
});
