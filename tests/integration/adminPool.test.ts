// tests/integration/adminPool.test.ts — opening /admin takes no connection from the tables: the
// snapshot runs on the admin pool, and no more of its queries at once than that pool holds.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import type { PoolClient } from "pg";
import { startTestServer, hasDatabase, skipMessage, type TestServer } from "../helpers/testServer.ts";
import { adminSnapshot } from "../../server/http/admin.ts";
import { adminPool, pool } from "../../server/store/db.ts";
import { profileMax } from "../../server/store/pool.ts";

describe("the admin page's pool", { skip: hasDatabase() ? false : skipMessage() }, () => {
  let server: TestServer;
  before(async () => { server = await startTestServer(); });
  after(async () => { if (server) await server.stop(); });

  test("the snapshot resolves with every app connection taken, two queries at a time", async () => {
    const admin = adminPool();
    let running = 0;
    let peak = 0;
    let queued = 0;
    const acquired = () => {
      peak = Math.max(peak, ++running);
      queued = Math.max(queued, admin.waitingCount);
    };
    const released = () => running--;
    admin.on("acquire", acquired);
    admin.on("release", released);

    const held: PoolClient[] = [];
    try {
      for (let i = 0; i < pool().options.max!; i++) held.push(await pool().connect());
      assert.equal(pool().idleCount, 0);

      const snapshot = await adminSnapshot(10);
      assert.equal(typeof snapshot.totalUsers, "number");
      assert.equal(profileMax("admin"), 2);
      assert.ok(peak >= 1 && peak <= 2, `${peak} admin queries ran at once`);
      assert.equal(queued, 0, "a snapshot query waited on the admin pool");
    } finally {
      for (const client of held) client.release();
      admin.off("acquire", acquired);
      admin.off("release", released);
    }
  });
});
