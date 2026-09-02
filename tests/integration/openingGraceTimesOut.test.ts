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

const GRANTED_MS = AFK_MS + Reading.notice;
// Generous both ways: the lower bound is what proves the grace was actually
// applied (a seat auto-passed at plain AFK_MS would fail it), the upper bound
// is what proves the window still ends (a seat never passed would time this
// test out well before reaching it).
const TOLERANCE_MS = 1500;

interface Notification {
  type?: string;
  code?: string;
  message?: string;
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

        const notified = waitFor<Notification>(
          clients[1].socket,
          "game:notification",
          GRANTED_MS + TOLERANCE_MS + 5_000
        );
        const armedAt = Date.now();
        await startGame(clients);

        const notice = await notified;
        const elapsedMs = Date.now() - armedAt;

        assert.equal(notice.type, "afk");
        assert.equal(notice.code, "PLAYER_AFK_AUTO_PASS");
        assert.ok(
          elapsedMs >= GRANTED_MS - TOLERANCE_MS,
          `auto-passed after ${elapsedMs}ms — too soon for afkTimeoutMs() (${AFK_MS}ms) + Reading.notice (${Reading.notice}ms); the opener's grace was not applied`
        );
        assert.ok(
          elapsedMs <= GRANTED_MS + TOLERANCE_MS,
          `auto-passed after ${elapsedMs}ms — the opening grace must still end, not run past afkTimeoutMs() + Reading.notice (${GRANTED_MS}ms)`
        );
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
