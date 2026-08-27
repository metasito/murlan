import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import {
  startTestServer,
  hasDatabase,
  skipMessage,
  type TestServer,
} from "../helpers/testServer.ts";
import { connectAs, waitFor } from "../helpers/client.ts";
import { setUpRoom, startGame } from "../helpers/table.ts";

/**
 * A throw inside a turn timer must close the table, not freeze it.
 *
 * `armTurn` clears the room's timers before arming the next one and is only
 * reached from a move, a rejoin, a disconnect or another timer, so a throw that
 * escapes a timer body leaves the room with nothing pending and nothing that
 * will ever re-arm it. Every human at the table then sits in front of a board
 * that never moves, with no error and no clock — the client's countdown has no
 * `onExpire` by design.
 */

process.env.MURLAN_AFK_TIMEOUT_MS = "60000";

interface Notification {
  type?: string;
  code?: string;
  message?: string;
}

describe(
  "timer containment",
  { skip: hasDatabase() ? false : skipMessage() },
  () => {
    let server: TestServer;
    before(async () => {
      server = await startTestServer();
    });
    after(async () => {
      await server.stop();
    });

    test("a throwing timer body closes the table instead of freezing it", async () => {
      const alice = await connectAs(server, "timer_boom_alice");
      const bob = await connectAs(server, "timer_boom_bob");
      const room = await setUpRoom([alice, bob], 2);
      await startGame([alice, bob]);

      const { hasActiveGame } = await import("../helpers/liveGame.ts");
      const { __testables } = await import("../../server/socket.ts");
      assert.equal(
        hasActiveGame(room.roomId),
        true,
        "the game must be live before the timer throws"
      );

      const announced = waitFor<Notification>(
        alice.socket,
        "game:notification",
        5_000
      );

      // The containment contract itself: whatever the body was, it threw.
      __testables.runTimerBody("botTurn", room.roomId, () => {
        throw new Error("boom");
      });

      try {
        const notice = await announced;
        assert.equal(notice.code, "GAME_INTERRUPTED_SERVER_ERROR");
        assert.equal(notice.type, "abandoned");

        // The freeze is the absence of both: a room still in memory, not over,
        // with no timer that will ever fire for it.
        assert.equal(
          hasActiveGame(room.roomId),
          false,
          "a table whose timer threw must not survive in memory"
        );
      } finally {
        alice.socket.close();
        bob.socket.close();
      }
    });

    /**
     * The test above proves the contract; this proves every timer body is
     * actually under it. Reaching the real bodies would need `autoMoveForSeat`
     * to throw on demand, and a fault injector in the turn path costs more than
     * it proves.
     */
    test("every turn timer body runs under the containment", () => {
      const serverDir = new URL("../../server/", import.meta.url);
      const source = readdirSync(serverDir)
        .filter((f) => f.endsWith(".ts"))
        .map((f) => readFileSync(new URL(f, serverDir), "utf8"))
        .join("\n");

      const timerBodies = [
        { label: "botTurn", call: "runBotTurn(io, roomId)" },
        { label: "afkAutoPass", call: "handleAutoPass(io, roomId, userId)" },
      ];

      for (const { label, call } of timerBodies) {
        const wrapper = new RegExp(
          `safeTimer\\([^"]*"${label}"[\\s\\S]{0,400}?${call.replace(
            /[.*+?^${}()|[\]\\]/g,
            "\\$&"
          )}`
        );
        assert.match(
          source,
          wrapper,
          `${call} must run inside safeTimer("${label}", …)`
        );
      }

      // A bare re-introduction is the regression: the two calls above may
      // appear only where safeTimer already covers them, or as the recursive
      // re-arm inside runBotTurn itself.
      const setTimeoutBodies = source.match(/setTimeout\(\(\) => \{[\s\S]*?\}, [A-Z_]+\)/g) ?? [];
      for (const body of setTimeoutBodies) {
        if (!/runBotTurn|handleAutoPass/.test(body)) continue;
        assert.match(
          body,
          /safeTimer\(/,
          `a setTimeout body driving a turn must go through safeTimer:\n${body}`
        );
      }
    });
  }
);
