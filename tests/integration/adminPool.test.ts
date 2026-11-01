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

  test("two snapshots at once resolve with every app connection taken, asking no more of the admin pool than it holds", async () => {
    const admin = adminPool();
    let running = 0;
    let peak = 0;
    let demand = 0;
    const acquired = () => {
      peak = Math.max(peak, ++running);
      demand = Math.max(demand, running + admin.waitingCount);
    };
    const released = () => running--;
    admin.on("acquire", acquired);
    admin.on("release", released);

    const held: PoolClient[] = [];
    try {
      for (let i = 0; i < pool().options.max!; i++) held.push(await pool().connect());
      assert.equal(pool().idleCount, 0);

      const snapshots = await Promise.all([adminSnapshot(10), adminSnapshot(10)]);
      for (const snapshot of snapshots) assert.equal(typeof snapshot.totalUsers, "number");
      assert.ok(peak >= 1 && peak <= profileMax("admin"), `${peak} admin queries ran at once`);
      assert.ok(demand <= profileMax("admin"), `${demand} snapshot queries asked the admin pool for a connection at once`);
    } finally {
      for (const client of held) client.release();
      admin.off("acquire", acquired);
      admin.off("release", released);
    }
  });
});
