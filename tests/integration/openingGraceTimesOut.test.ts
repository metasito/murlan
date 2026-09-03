import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import {
  startTestServer,
  hasDatabase,
  skipMessage,
  type TestServer,
} from "../helpers/testServer.ts";
import { waitFor } from "../helpers/client.ts";
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
 * Whether a promise settles by its own timeout rather than resolving —
 * `tests/wallClockBudgets.test.ts` bans asserting a measured duration against
 * a fixed number, so what proves "not yet" here is which branch of `waitFor`'s
 * own deadline wins, never a clock reading compared to one.
 */
async function didTimeOut(promise: Promise<unknown>): Promise<boolean> {
  try {
    await promise;
    return false;
  } catch {
    return true;
  }
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

        // Comfortably longer than the base AFK window alone, and nowhere near
        // afkTimeoutMs() + Reading.notice: if the grace were not applied, a
        // plain AFK auto-pass would land well inside this and resolve it.
        const stillPending = waitFor<Notification>(
          clients[1].socket,
          "game:notification",
          AFK_MS + 1_000
        );
        await startGame(clients);
        assert.equal(
          await didTimeOut(stillPending),
          true,
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
