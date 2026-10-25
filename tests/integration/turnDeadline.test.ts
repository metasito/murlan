import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import {
  startTestServer,
  hasDatabase,
  skipMessage,
  type TestServer,
} from "../helpers/testServer.ts";
import { leaveRooms, waitFor } from "../helpers/client.ts";
import { fakeClock } from "../helpers/fakeClock.ts";
import { installClock } from "../../server/http/clock.ts";
import { makeClients, setUpRoom, type Client } from "../helpers/table.ts";
import { Reading } from "../../lib/tokens.ts";

/**
 * Long enough that no seat is auto-passed while the assertions run, and
 * nothing like the 30 the client used to hardcode — the point of the suite is
 * that the displayed clock follows this value with no client change.
 */
const AFK_SECONDS = 9;
process.env.MURLAN_AFK_TIMEOUT_MS = String(AFK_SECONDS * 1000);
/**
 * `room:start` deals the match's first round, whose opener carries the
 * opening announcement's reading time on top of the base window (#830) — the
 * seat this whole file arms and watches.
 */
const OPENING_GRACE_SECONDS = Reading.notice / 1000;

describe("turn deadline", { skip: hasDatabase() ? false : skipMessage() }, () => {
  let server: TestServer;
  before(async () => {
    server = await startTestServer();
  });
  after(async () => {
    await server.stop();
  });

  async function closeTable(clients: Client[]) {
    await leaveRooms(clients.map((c) => c.socket));
  }

  test("the window the server armed is the window the table is told about", async () => {
    const clients = await makeClients(server, ["deadline_a", "deadline_b"]);
    try {
      await setUpRoom(clients, 2);
      const armed = waitFor(clients[1].socket, "game:turn_deadline");
      clients[0].socket.emit("room:start", {});
      const deadline = await armed;

      assert.equal(
        deadline.turnSecondsRemaining,
        AFK_SECONDS + OPENING_GRACE_SECONDS,
        "the opener's first turn is MURLAN_AFK_TIMEOUT_MS plus the opening announcement's grace (#830), not a client constant"
      );
      assert.ok(
        typeof deadline.turnDeadlineMs === "number",
        "the deadline rides along as the clock's reset key"
      );
    } finally {
      await closeTable(clients);
      for (const c of clients) c.socket.close();
    }
  });

  test("a rejoin is told the window that is left, not a fresh one", async () => {
    const clients = await makeClients(server, ["deadline_c", "deadline_d"]);
    try {
      const room = await setUpRoom(clients, 2);
      const clock = fakeClock(Date.now());
      const restore = installClock(clock);
      try {
        const armed = waitFor(clients[0].socket, "game:turn_deadline");
        clients[0].socket.emit("room:start", {});
        await armed;

        const elapsedMs = 2500;
        clock.advance(elapsedMs);

        const rejoined = waitFor(clients[0].socket, "game:state");
        clients[0].socket.emit("game:rejoin", { roomId: room.roomId });
        const state = await rejoined;

        assert.equal(state.turnSecondsRemaining, Math.ceil(AFK_SECONDS + OPENING_GRACE_SECONDS - elapsedMs / 1000));
      } finally {
        restore();
      }
    } finally {
      await closeTable(clients);
      for (const c of clients) c.socket.close();
    }
  });
});
