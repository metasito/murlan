import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import {
  startTestServer,
  hasDatabase,
  skipMessage,
  type TestServer,
} from "../helpers/testServer.ts";
import { eventually, leaveRooms, nothingArrives, waitForWhere } from "../helpers/client.ts";
import { fakeClock } from "../helpers/fakeClock.ts";
import { installClock } from "../../server/http/clock.ts";
import { pending, seatKey } from "../../server/game/gameTimers.ts";
import { makeClients, setUpRoom, startGame } from "../helpers/table.ts";
import { Reading } from "../../lib/tokens.ts";

/**
 * #830's grace is bounded by `Reading.notice`, not open-ended — a genuinely
 * AFK opener still gets auto-passed, just after the base window *plus* the
 * grace rather than the base window alone. `node --test` gives this file its
 * own process, so this override never leaks into another file.
 */
const AFK_MS = 300;
process.env.MURLAN_AFK_TIMEOUT_MS = String(AFK_MS);

describe(
  "a genuinely AFK opener still times out (#830)",
  { skip: hasDatabase() ? false : skipMessage() },
  () => {
    let server: TestServer;
    before(async () => {
      server = await startTestServer();
    });
    after(async () => {
      await server.stop();
    });

    test("the opener's first turn is auto-passed at afkTimeoutMs() + Reading.notice, not before and not never", async () => {
      const clients = await makeClients(server, ["grace_afk_a", "grace_afk_b"]);
      try {
        const room = await setUpRoom(clients, 2);
        const clock = fakeClock(Date.now());
        const restore = installClock(clock);
        try {
          const [opening] = await startGame(clients);
          const opener = clients[opening!.currentTurnIndex]!;
          await eventually(
            () => pending("afk", seatKey(room.roomId, opener.user.id)),
            "the opener's AFK timer armed"
          );
          const isAfk = (notice: { type: string }) => notice.type === "afk";

          clock.advance(AFK_MS + Reading.notice - 1);
          setTimeout(() => (clients[1]!.socket as unknown as { emitEvent(args: unknown[]): void }).emitEvent(["game:notification", { type: "afk" }]), 50); // RED: injected emit
          await nothingArrives(clients[1]!.socket, "game:notification", {
            matches: isAfk,
            why: "the opener was auto-passed before its base AFK window plus the opening grace ran out",
          });

          const notice = waitForWhere(clients[1]!.socket, "game:notification", isAfk);
          clock.advance(1);
          assert.equal((await notice).code, "PLAYER_AFK_AUTO_PASS");
        } finally {
          restore();
        }
      } finally {
        // Neither client ever plays, so with AFK_MS this small the table keeps
        // auto-passing itself long after the assertions above are done —
        // closing the room stops that before `after()` tears down the pool
        // underneath it.
        await leaveRooms(clients.map((c) => c.socket));
        for (const c of clients) c.socket.close();
      }
    });
  }
);
