import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import {
  startTestServer,
  hasDatabase,
  skipMessage,
  type TestServer,
} from "../helpers/testServer.ts";
import { waitFor } from "../helpers/client.ts";
import type { Socket } from "socket.io-client";
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

interface Notification {
  type?: string;
  code?: string;
  message?: string;
}

/**
 * Whether the auto-pass has *not* arrived within `ms` — the one wait in this
 * file that must not be scaled by `DEADLINE_SCALE`.
 *
 * Every other deadline in the suite is an upper bound ("give up after"), and
 * scaling those on a slow runner is what keeps them honest. This is a lower
 * bound ("must not have happened yet"), measured against a server timer that
 * `MURLAN_AFK_TIMEOUT_MS` fixes in real milliseconds and no scale touches.
 * Scaling it does not add tolerance, it moves the window *past* the deadline
 * it is supposed to sit before — at CI's scale of 4 this window ran to 5200ms
 * against a 4300ms grace, and the test failed on every CI run while passing
 * on every local one. Load can only push the auto-pass later, which is the
 * safe direction for a lower bound, so this one needs no scale at all.
 *
 * Filtered to the AFK notification rather than the first `game:notification`
 * of any kind: a stray notice of another type would otherwise read as the
 * auto-pass having fired.
 */
function afkArrivesWithin(socket: Socket, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const onNotice = (payload: Notification) => {
      if (payload?.type !== "afk") return;
      socket.off("game:notification", onNotice);
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      socket.off("game:notification", onNotice);
      resolve(false);
    }, ms);
    socket.on("game:notification", onNotice);
  });
}

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
        await setUpRoom(clients, 2);

        // Comfortably past the base AFK window alone and comfortably short of
        // it plus the grace: if the grace were not applied, the auto-pass
        // would land well inside this.
        const tooEarly = afkArrivesWithin(clients[1].socket, AFK_MS + 1_000);
        await startGame(clients);
        assert.equal(
          await tooEarly,
          false,
          "the opener was auto-passed within its base AFK window alone — the opening grace was not applied"
        );

        // The grace still ends: a generous but bounded second wait must catch
        // the auto-pass that the first, deliberately short one was too early
        // for.
        const notice = await waitFor<Notification>(
          clients[1].socket,
          "game:notification",
          Reading.notice + 5_000
        );
        assert.equal(notice.type, "afk");
        assert.equal(notice.code, "PLAYER_AFK_AUTO_PASS");
      } finally {
        // Neither client ever plays, so with AFK_MS this small the table keeps
        // auto-passing itself long after the assertions above are done —
        // closing the room stops that before `after()` tears down the pool
        // underneath it.
        clients[0].socket.emit("room:leave");
        await new Promise((resolve) => setTimeout(resolve, 50));
        for (const c of clients) c.socket.close();
      }
    });
  }
);
