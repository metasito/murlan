import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import {
  startTestServer,
  hasDatabase,
  skipMessage,
  type TestServer,
} from "../helpers/testServer.ts";
import { waitFor } from "../helpers/client.ts";
import { makeClients, setUpRoom, type Client } from "../helpers/table.ts";
import type { SanitizedState } from "../helpers/gameDriver.ts";

/**
 * Long enough that no seat is auto-passed while the assertions run, and
 * nothing like the 30 the client used to hardcode — the point of the suite is
 * that the displayed clock follows this value with no client change.
 * `server/socket.ts` reads it once at module scope, so it must be set before
 * that module is first imported.
 */
const AFK_SECONDS = 9;
process.env.MURLAN_AFK_TIMEOUT_MS = String(AFK_SECONDS * 1000);

interface TurnDeadline {
  turnDeadlineMs?: number;
  turnSecondsRemaining: number;
}

describe("turn deadline", { skip: hasDatabase() ? false : skipMessage() }, () => {
  let server: TestServer;
  before(async () => {
    server = await startTestServer();
  });
  after(async () => {
    await server.stop();
  });

  async function closeTable(host: Client) {
    host.socket.emit("room:leave");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  test("the window the server armed is the window the table is told about", async () => {
    const clients = await makeClients(server, ["deadline_a", "deadline_b"]);
    try {
      await setUpRoom(clients, 2);
      const armed = waitFor<TurnDeadline>(clients[1].socket, "game:turn_deadline");
      clients[0].socket.emit("room:start");
      const deadline = await armed;

      assert.equal(
        deadline.turnSecondsRemaining,
        AFK_SECONDS,
        "the countdown is MURLAN_AFK_TIMEOUT_MS, not a client constant"
      );
      assert.ok(
        typeof deadline.turnDeadlineMs === "number",
        "the deadline rides along as the clock's reset key"
      );
    } finally {
      await closeTable(clients[0]);
      for (const c of clients) c.socket.close();
    }
  });

  test("a rejoin is told the window that is left, not a fresh one", async () => {
    const clients = await makeClients(server, ["deadline_c", "deadline_d"]);
    try {
      const room = await setUpRoom(clients, 2);
      const armed = waitFor<TurnDeadline>(clients[0].socket, "game:turn_deadline");
      clients[0].socket.emit("room:start");
      await armed;

      const elapsedMs = 2500;
      await new Promise((resolve) => setTimeout(resolve, elapsedMs));

      const rejoined = waitFor<SanitizedState & TurnDeadline>(clients[0].socket, "game:state");
      clients[0].socket.emit("game:rejoin", { roomId: room.roomId });
      const state = await rejoined;

      const expected = AFK_SECONDS - elapsedMs / 1000;
      assert.ok(
        Math.abs(state.turnSecondsRemaining - expected) <= 1,
        `expected about ${expected}s left, got ${state.turnSecondsRemaining}`
      );
    } finally {
      await closeTable(clients[0]);
      for (const c of clients) c.socket.close();
    }
  });
});
