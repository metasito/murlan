// tests/integration/socketCloseReason.test.ts — #844: every socket close is
// recorded with the reason Socket.IO itself gave for it.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import {
  startTestServer,
  hasDatabase,
  skipMessage,
  type TestServer,
} from "../helpers/testServer.ts";
import { connectAs } from "../helpers/client.ts";

describe("socket close reason", { skip: hasDatabase() ? false : skipMessage() }, () => {
  let server: TestServer;
  let dbPool: pg.Pool;

  before(async () => {
    server = await startTestServer();
    dbPool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  });

  after(async () => {
    await dbPool.end();
    await server.stop();
  });

  const closesFor = async (userId: string) =>
    (
      await dbPool.query<{ context: { reason?: string } }>(
        `SELECT context FROM "${server.schema}".events WHERE name = 'socket.closed' AND user_id = $1`,
        [userId]
      )
    ).rows;

  /** The write is fire-and-forget, so it lands just after the disconnect. */
  async function settle(userId: string, want: number) {
    let rows: { context: { reason?: string } }[] = [];
    for (let attempt = 0; attempt < 20; attempt++) {
      rows = await closesFor(userId);
      if (rows.length >= want) return rows;
      await new Promise((r) => setTimeout(r, 50));
    }
    return rows;
  }

  test("a client-initiated close is recorded with the reason Socket.IO named", async () => {
    const alice = await connectAs(server, "closereason_alice");

    alice.socket.disconnect();
    const rows = await settle(alice.user.id, 1);

    assert.equal(rows.length, 1, "the disconnect must have been recorded exactly once");
    // What the client's own .disconnect() produces server-side — verbatim
    // from socket.io, not chosen by this code.
    assert.equal(rows[0].context.reason, "client namespace disconnect");
  });

  // The room/seat-release branch inside registerDisconnect returns early for
  // several cases (no room, still connected elsewhere, another instance holds
  // the game) — the recording has to run before any of them, not fall through
  // whichever one this socket happens to hit.
  test("a socket that never held a room is still recorded", async () => {
    const bob = await connectAs(server, "closereason_bob");

    bob.socket.disconnect();
    const rows = await settle(bob.user.id, 1);

    assert.equal(rows.length, 1, "a socket that joined no room must still have its close recorded");
  });
});
