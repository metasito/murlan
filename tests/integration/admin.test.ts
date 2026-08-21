// tests/integration/admin.test.ts — /admin is a new authenticated surface over
// everyone's data, not another player route.
//
// The half that matters is the refusal. A dashboard that answers the owner is
// only worth having if it answers nobody else, so both directions are driven
// here against the real server: an ordinary signed-in account must get exactly
// what a stranger gets, and neither may learn that the page exists.
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

describe("the admin dashboard", { skip: hasDatabase() ? false : skipMessage() }, () => {
  let server: TestServer;
  let dbPool: pg.Pool;
  let ownerCookie: string;
  let playerCookie: string;
  let retentionDays: number;

  before(async () => {
    server = await startTestServer();
    // Imported here, not at file scope: server/db.ts reads DATABASE_URL when
    // it is first loaded, and startTestServer() is what points that at this
    // run's own schema. A top-level import would connect to public instead.
    ({ CLIENT_ERROR_RETENTION_DAYS: retentionDays } = await import("../../server/clientErrors.ts"));
    dbPool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

    ({ cookie: ownerCookie } = await register(server, "the_owner"));
    ({ cookie: playerCookie } = await register(server, "a_player"));

    await dbPool.query(
      `UPDATE "${server.schema}".users SET is_admin = true WHERE username = $1`,
      ["the_owner"]
    );
  });

  after(async () => {
    await dbPool.end();
    await server.stop();
  });

  const get = (cookie?: string) =>
    fetch(`${server.url}/admin`, { headers: cookie ? { cookie } : {} });

  test("a stranger is not told the page exists", async () => {
    const res = await get();

    assert.equal(res.status, 404);
  });

  test("an ordinary account gets exactly what the stranger got", async () => {
    // 404 rather than 403 on purpose: a signed-in player must not be able to
    // confirm that an admin surface is there to be attacked.
    const res = await get(playerCookie);

    assert.equal(res.status, 404);
  });

  test("the owner gets the page", async () => {
    const res = await get(ownerCookie);
    const body = await res.text();

    assert.equal(res.status, 200, body.slice(0, 200));
    assert.match(res.headers.get("content-type") ?? "", /text\/html/);
  });

  test("all seven questions are answered on it", async () => {
    const body = await (await get(ownerCookie)).text();

    for (const question of [
      "Signups over time",
      "Played today / this week",
      "Retention cohorts",
      "Around but not playing",
      "Ladder health",
      "Match balance",
      "Started but never finished",
    ]) {
      assert.ok(body.includes(question), `the page never answers "${question}"`);
    }
  });

  test("a crash report becomes a row, not only a log line", async () => {
    const res = await fetch(`${server.url}/api/client-errors`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: playerCookie },
      body: JSON.stringify({ message: "a crash worth reading later", platform: "web" }),
    });
    assert.equal(res.status, 204);

    // The write is fire-and-forget, so it may land just after the 204.
    let rows: { message: string }[] = [];
    for (let attempt = 0; attempt < 20 && rows.length === 0; attempt++) {
      const result = await dbPool.query<{ message: string }>(
        `SELECT message FROM "${server.schema}".client_errors WHERE message = $1`,
        ["a crash worth reading later"]
      );
      rows = result.rows;
      if (rows.length === 0) await new Promise((r) => setTimeout(r, 50));
    }

    assert.equal(rows.length, 1, "the crash report was never stored");
  });

  test("a report older than the retention window is deleted, not merely documented", async () => {
    await dbPool.query(
      `INSERT INTO "${server.schema}".client_errors (message, occurred_at)
       VALUES ($1, now() - make_interval(days => $2))`,
      ["ancient crash", retentionDays + 1]
    );

    const before = await dbPool.query(
      `SELECT 1 FROM "${server.schema}".client_errors WHERE message = $1`,
      ["ancient crash"]
    );
    assert.equal(before.rows.length, 1, "the fixture row was never inserted");

    // The prune rides the next insert, as the replay prune does, so no
    // scheduled job can be skipped or forgotten.
    await fetch(`${server.url}/api/client-errors`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: playerCookie },
      body: JSON.stringify({ message: "a fresh crash", platform: "web" }),
    });

    let remaining = 1;
    for (let attempt = 0; attempt < 20 && remaining > 0; attempt++) {
      const result = await dbPool.query(
        `SELECT 1 FROM "${server.schema}".client_errors WHERE message = $1`,
        ["ancient crash"]
      );
      remaining = result.rows.length;
      if (remaining > 0) await new Promise((r) => setTimeout(r, 50));
    }

    assert.equal(remaining, 0, "a report past the retention window survived");
  });

  // #166: the whole point is one row per crash, not one per event.
  test("two crashes with the same fingerprint show as one row with a count", async () => {
    const { cookie: crasher } = await register(server, "crash_admin_group");
    const message = "grouped crash for the admin panel";
    for (let i = 0; i < 2; i++) {
      await fetch(`${server.url}/api/client-errors`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: crasher },
        body: JSON.stringify({ message, stack: "at renderCard (Card.tsx:1:1)" }),
      });
    }

    // Both writes are fire-and-forget, so wait for both rows before reading
    // the page — the page can otherwise be read between the two landing,
    // showing a real but momentary count of 1.
    let rows: { message: string }[] = [];
    for (let attempt = 0; attempt < 20 && rows.length < 2; attempt++) {
      const result = await dbPool.query<{ message: string }>(
        `SELECT message FROM "${server.schema}".client_errors WHERE message = $1`,
        [message]
      );
      rows = result.rows;
      if (rows.length < 2) await new Promise((r) => setTimeout(r, 50));
    }
    assert.equal(rows.length, 2, "both crash reports were never stored");

    const body = await (await get(ownerCookie)).text();
    assert.equal(
      body.split(message).length - 1,
      1,
      "the two crashes rendered as more than one row"
    );
    assert.match(body, new RegExp(`<td>${message}</td><td>2</td>`));
  });

  // The floor under grouping: a real crash from before this column existed
  // must not vanish into some other row just because both have no fingerprint.
  test("rows with no fingerprint are never merged into each other", async () => {
    const message = "a legacy crash with no fingerprint";
    await dbPool.query(
      `INSERT INTO "${server.schema}".client_errors (message, occurred_at) VALUES ($1, now()), ($1, now())`,
      [message]
    );

    const body = await (await get(ownerCookie)).text();
    assert.equal(body.split(message).length - 1, 2, "two legacy rows collapsed into one group");
  });
});
