// tests/integration/events.test.ts — the funnel steps, and the promise that
// they can never cost a game.
//
// This table is diagnostic. Nothing in a round depends on it, so a write that
// fails must cost a log line and nothing else — never a rejected move, never a
// dropped socket (tests/server/telemetryBatch.test.ts fails a batch).
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import {
  startTestServer,
  hasDatabase,
  skipMessage,
  type TestServer,
} from "../helpers/testServer.ts";
import { eventually, register } from "../helpers/client.ts";
import { flushTelemetry, telemetryRowsDropped } from "../../server/shared/telemetryBatch.ts";
import { logger } from "../../server/shared/logger.ts";
import { EVENT_NAMES } from "../../shared/events.ts";
import { trackEvent, EVENT_RETENTION_DAYS as retentionDays } from "../../server/shared/events.ts";
import { sweepRetention } from "../../server/game/retention.ts";

describe("funnel events", { skip: hasDatabase() ? false : skipMessage() }, () => {
  let server: TestServer;
  let cookie: string;
  let ownerCookie: string;

  before(async () => {
    server = await startTestServer();

    ({ cookie } = await register(server, "funnel_player"));
    ({ cookie: ownerCookie } = await register(server, "funnel_owner"));
    await server.query(
      `UPDATE "${server.schema}".users SET is_admin = true WHERE username = $1`,
      ["funnel_owner"]
    );
  });

  after(async () => {
    await server.stop();
  });

  const rowsNamed = async (name: string) =>
    server.query<{ name: string }>(`SELECT name FROM "${server.schema}".events WHERE name = $1`, [name]);

  /** The write is fire-and-forget, so it lands just after the response. */
  const landed = (name: string) =>
    eventually(async () => (await rowsNamed(name)).length >= 1, `a "${name}" row`);

  test("opening the tutorial is recorded once, not once per device", async () => {
    const seen = () =>
      fetch(`${server.url}/api/users/me/tutorial-seen`, { method: "POST", headers: { cookie } });

    assert.equal((await seen()).status, 200);
    await landed("tutorial.started");

    // The same endpoint is the catch-up write app/index.tsx makes when the
    // device knows and the account does not. That is not a second player
    // opening the tutorial.
    assert.equal((await seen()).status, 200);
    await flushTelemetry();

    assert.equal((await rowsNamed("tutorial.started")).length, 1);
  });

  test("rows queued for an account deleted before they are written are not stored; an anonymous one beside them is", async () => {
    const {
      user: { id: goneId },
    } = await register(server, "funnel_gone");
    const before = telemetryRowsDropped();
    trackEvent("game.firstMoveMade", goneId);
    trackEvent("game.firstMoveMade", "00000000-0000-0000-0000-000000000000");
    trackEvent("game.firstMoveMade", null);
    await server.query(`DELETE FROM "${server.schema}".users WHERE id = $1`, [goneId]);
    await flushTelemetry();

    const rows = await server.query<{ user_id: string | null }>(
      `SELECT user_id FROM "${server.schema}".events WHERE name = $1`,
      ["game.firstMoveMade"]
    );
    assert.deepEqual(rows.map((r) => r.user_id), [null], "a deleted account's row outlived its deletion");
    assert.ok(telemetryRowsDropped() - before >= 2, "the rows the join dropped were not counted");

    const res = await fetch(`${server.url}/api/auth/me`, { headers: { cookie } });
    assert.equal(res.status, 200);
  });

  test("a batch the database refuses for one row loses that row alone, and never reaches the caller", async (t) => {
    t.mock.method(logger, "error", () => undefined);
    await server.query(
      `ALTER TABLE "${server.schema}".events ADD CONSTRAINT refuse_poison CHECK (context->>'gameMode' IS DISTINCT FROM 'poison')`
    );
    t.after(() => server.query(`ALTER TABLE "${server.schema}".events DROP CONSTRAINT refuse_poison`));
    const before = telemetryRowsDropped();

    assert.doesNotThrow(() => trackEvent("room.joined", null, { gameMode: "kept-before" }));
    trackEvent("room.joined", null, { gameMode: "poison" });
    trackEvent("room.joined", null, { gameMode: "kept-after" });
    await flushTelemetry();

    const modes = await server.query<{ mode: string }>(
      `SELECT context->>'gameMode' AS mode FROM "${server.schema}".events WHERE name = $1 ORDER BY mode`,
      ["room.joined"]
    );
    assert.deepEqual(modes.map((r) => r.mode), ["kept-after", "kept-before"]);
    assert.equal(telemetryRowsDropped() - before, 1);
  });

  test("retention is off the write path, and the scheduled sweep still works", async () => {
    await server.query(
      `INSERT INTO "${server.schema}".events (name, occurred_at)
       VALUES ($1, now() - make_interval(days => $2))`,
      ["lobby.entered", retentionDays + 1]
    );
    assert.equal((await rowsNamed("lobby.entered")).length, 1);

    trackEvent("room.joined", null);
    await landed("room.joined");

    assert.equal(
      (await rowsNamed("lobby.entered")).length,
      1,
      "a write must not prune the table it just grew"
    );

    await sweepRetention();

    assert.equal(
      (await rowsNamed("lobby.entered")).length,
      0,
      "the scheduled sweep must still remove a row past the retention window"
    );
  });

  test("the funnel renders on /admin", async () => {
    trackEvent("room.joined", null, { playerCount: 4, gameMode: "free_for_all" });
    await landed("room.joined");

    const body = await (await fetch(`${server.url}/admin`, { headers: { cookie: ownerCookie } })).text();

    assert.ok(body.includes("Where people drop out"), "the funnel panel is not on the page");
    assert.ok(body.includes("room.joined"), "the step that was recorded is not shown");
  });

  test("the recorded names are the closed set, and nothing else", () => {
    // A table that accepts any string stops adding up. This is the guard on
    // the set itself rather than on one call site.
    assert.deepEqual(
      [...EVENT_NAMES].sort(),
      [
        "game.abandoned",
        "game.firstMoveMade",
        "lobby.entered",
        "mail.sendFailed",
        "room.joined",
        "socket.closed",
        "tutorial.started",
      ]
    );
  });
});
