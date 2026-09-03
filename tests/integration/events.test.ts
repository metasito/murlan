// tests/integration/events.test.ts — the funnel steps, and the promise that
// they can never cost a game.
//
// This table is diagnostic. Nothing in a hand depends on it, so a write that
// fails must cost a log line and nothing else — never a rejected move, never a
// dropped socket. That is asserted here with an insert that genuinely fails,
// not with a mock that pretends to.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import {
  startTestServer,
  hasDatabase,
  skipMessage,
  type TestServer,
} from "../helpers/testServer.ts";
import { register } from "../helpers/client.ts";
import { EVENT_NAMES } from "../../shared/events.ts";

describe("funnel events", { skip: hasDatabase() ? false : skipMessage() }, () => {
  let server: TestServer;
  let dbPool: pg.Pool;
  let cookie: string;
  let ownerCookie: string;
  let trackEvent: typeof import("../../server/events.ts").trackEvent;
  let retentionDays: number;

  before(async () => {
    server = await startTestServer();
    // After startTestServer, never at file scope: server/db.ts binds to
    // DATABASE_URL when first loaded, and the harness is what points that at
    // this run's own schema.
    ({ trackEvent, EVENT_RETENTION_DAYS: retentionDays } = await import(
      "../../server/events.ts"
    ));
    dbPool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

    ({ cookie } = await register(server, "funnel_player"));
    ({ cookie: ownerCookie } = await register(server, "funnel_owner"));
    await dbPool.query(
      `UPDATE "${server.schema}".users SET is_admin = true WHERE username = $1`,
      ["funnel_owner"]
    );
  });

  after(async () => {
    await dbPool.end();
    await server.stop();
  });

  const rowsNamed = async (name: string) =>
    (
      await dbPool.query<{ name: string }>(
        `SELECT name FROM "${server.schema}".events WHERE name = $1`,
        [name]
      )
    ).rows;

  /** The write is fire-and-forget, so it lands just after the response. */
  async function settle<T>(read: () => Promise<T[]>, want: number): Promise<T[]> {
    let rows: T[] = [];
    for (let attempt = 0; attempt < 20; attempt++) {
      rows = await read();
      if (rows.length >= want) return rows;
      await new Promise((r) => setTimeout(r, 50));
    }
    return rows;
  }

  test("opening the tutorial is recorded once, not once per device", async () => {
    const seen = () =>
      fetch(`${server.url}/api/users/me/tutorial-seen`, { method: "POST", headers: { cookie } });

    assert.equal((await seen()).status, 200);
    await settle(() => rowsNamed("tutorial.started"), 1);

    // The same endpoint is the catch-up write app/index.tsx makes when the
    // device knows and the account does not. That is not a second player
    // opening the tutorial.
    assert.equal((await seen()).status, 200);
    await new Promise((r) => setTimeout(r, 300));

    assert.equal((await rowsNamed("tutorial.started")).length, 1);
  });

  test("a write that genuinely fails does not reach the caller", async () => {
    // No such user, so the foreign key rejects the insert. If trackEvent let
    // that surface, the move or the socket that emitted it would carry the
    // failure instead.
    assert.doesNotThrow(() =>
      trackEvent("game.firstMoveMade", "00000000-0000-0000-0000-000000000000")
    );
    await new Promise((r) => setTimeout(r, 400));

    // The row is genuinely absent — the insert really did fail, so this is not
    // a test of a write that quietly succeeded.
    assert.equal((await rowsNamed("game.firstMoveMade")).length, 0);

    // And the server is still serving.
    const res = await fetch(`${server.url}/api/auth/me`, { headers: { cookie } });
    assert.equal(res.status, 200);
  });

  test("a step older than the retention window is deleted by the next write", async () => {
    await dbPool.query(
      `INSERT INTO "${server.schema}".events (name, occurred_at)
       VALUES ($1, now() - make_interval(days => $2))`,
      ["lobby.entered", retentionDays + 1]
    );
    assert.equal((await rowsNamed("lobby.entered")).length, 1);

    trackEvent("room.joined", null);
    let remaining = 1;
    for (let attempt = 0; attempt < 20 && remaining > 0; attempt++) {
      remaining = (await rowsNamed("lobby.entered")).length;
      if (remaining > 0) await new Promise((r) => setTimeout(r, 50));
    }

    assert.equal(remaining, 0, "a step past the retention window survived");
  });

  test("the funnel renders on /admin", async () => {
    trackEvent("room.joined", null, { playerCount: 4, gameMode: "free_for_all" });
    await settle(() => rowsNamed("room.joined"), 1);

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
        "room.joined",
        "socket.closed",
        "tutorial.started",
      ]
    );
  });
});
