// tests/integration/clientErrors.test.ts — the crash-report endpoint.
//
// This is the only route that takes attacker-controlled free text and writes it
// straight into the server log, so its limits are the whole point of it. An
// unbounded stack field is a way to fill a disk, and an unauthenticated one is
// open log injection. Both are asserted here against the real server rather
// than inferred from the schema.
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

describe("client crash reports", { skip: hasDatabase() ? false : skipMessage() }, () => {
  let server: TestServer;
  let cookie: string;
  let dbPool: pg.Pool;

  before(async () => {
    server = await startTestServer();
    ({ cookie } = await register(server, "crash_reporter"));
    dbPool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  });
  after(async () => {
    await dbPool.end();
    await server.stop();
  });

  function post(body: unknown, withCookie = true) {
    return fetch(`${server.url}/api/client-errors`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(withCookie ? { cookie } : {}),
      },
      body: JSON.stringify(body),
    });
  }

  function postAs(as: string, body: unknown) {
    return fetch(`${server.url}/api/client-errors`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: as },
      body: JSON.stringify(body),
    });
  }

  test("an authenticated report is accepted", async () => {
    const res = await post({
      message: "Cannot read property 'cards' of null",
      stack: "at GameTable (components/GameTable.tsx:1)",
      platform: "ios",
    });
    assert.equal(res.status, 204, await res.text());
  });

  test("an unauthenticated report is refused", async () => {
    // Otherwise anyone on the internet can write arbitrary text into the log.
    const res = await post({ message: "injected" }, false);
    assert.equal(res.status, 401);
  });

  test("an oversized stack is refused rather than truncated silently", async () => {
    const res = await post({ message: "boom", stack: "x".repeat(4001) });
    assert.equal(res.status, 400);
  });

  test("an oversized message is refused", async () => {
    const res = await post({ message: "x".repeat(501) });
    assert.equal(res.status, 400);
  });

  test("an empty message is refused — it diagnoses nothing", async () => {
    const res = await post({ message: "" });
    assert.equal(res.status, 400);
  });

  test("an unknown platform is refused", async () => {
    const res = await post({ message: "boom", platform: "symbian" });
    assert.equal(res.status, 400);
  });

  // #165: the reporter now fills these, and they were columns nothing wrote.
  // `screen` is the route rather than the component stack — that stack is a
  // render-only detail and rides in `context`, so the column means the same
  // thing for a rejected promise as for a caught render.
  test("screen and appVersion reach their columns", async () => {
    const { cookie: own } = await register(server, "crash_fields");
    const message = "a rejection from a socket callback";
    const res = await postAs(own, {
      message,
      stack: "at onAck (context/SocketContext.tsx:1)",
      componentStack: "at Hand > at GameTable",
      screen: "/game",
      appVersion: "1.0.0",
      platform: "web",
    });
    assert.equal(res.status, 204, await res.text());

    // Fire-and-forget, so the row may land just after the 204.
    let rows: { screen: string | null; app_version: string | null; context: unknown }[] = [];
    for (let attempt = 0; attempt < 20 && rows.length === 0; attempt++) {
      const result = await dbPool.query<{
        screen: string | null;
        app_version: string | null;
        context: unknown;
      }>(
        `SELECT screen, app_version, context FROM "${server.schema}".client_errors WHERE message = $1`,
        [message]
      );
      rows = result.rows;
      if (rows.length === 0) await new Promise((r) => setTimeout(r, 50));
    }

    assert.equal(rows.length, 1, "the report was never stored");
    assert.equal(rows[0].screen, "/game");
    assert.equal(rows[0].app_version, "1.0.0");
    assert.deepEqual(rows[0].context, { componentStack: "at Hand > at GameTable" });
  });

  // The floor: without this, the assertion above passes just as well against a
  // handler that writes those two strings unconditionally.
  test("a report that omits them stores nulls, not a default", async () => {
    const { cookie: own } = await register(server, "crash_nulls");
    const message = "a crash with no route known yet";
    assert.equal((await postAs(own, { message })).status, 204);

    let rows: { screen: string | null; app_version: string | null }[] = [];
    for (let attempt = 0; attempt < 20 && rows.length === 0; attempt++) {
      const result = await dbPool.query<{ screen: string | null; app_version: string | null }>(
        `SELECT screen, app_version FROM "${server.schema}".client_errors WHERE message = $1`,
        [message]
      );
      rows = result.rows;
      if (rows.length === 0) await new Promise((r) => setTimeout(r, 50));
    }

    assert.equal(rows.length, 1, "the report was never stored");
    assert.equal(rows[0].screen, null);
    assert.equal(rows[0].app_version, null);
  });

  // #166: grouping on /admin is a hash and a GROUP BY, and this is the hash
  // half — two crashes group only if they compute the same fingerprint.
  test("two structurally identical crashes from different sessions get the same fingerprint", async () => {
    const { cookie: sessionA } = await register(server, "crash_fp_a");
    const { cookie: sessionB } = await register(server, "crash_fp_b");
    const message = "Cannot read property 'suit' of undefined";
    const stack = "at renderCard (components/Card.tsx:42:7)";

    await postAs(sessionA, { message, stack });
    await postAs(sessionB, { message, stack });

    let rows: { fingerprint: string | null }[] = [];
    for (let attempt = 0; attempt < 20 && rows.length < 2; attempt++) {
      const result = await dbPool.query<{ fingerprint: string | null }>(
        `SELECT fingerprint FROM "${server.schema}".client_errors WHERE message = $1`,
        [message]
      );
      rows = result.rows;
      if (rows.length < 2) await new Promise((r) => setTimeout(r, 50));
    }

    assert.equal(rows.length, 2, "both reports were never stored");
    assert.ok(rows[0].fingerprint, "no fingerprint was computed");
    assert.equal(rows[0].fingerprint, rows[1].fingerprint);
  });

  test("a content-hash change in the bundle filename does not split the fingerprint", async () => {
    const { cookie: own } = await register(server, "crash_fp_hash");
    const message = "same crash, two deploys apart";

    await postAs(own, { message, stack: "at renderCard (bundle.a1b2c3d4.js:100:5)" });
    await postAs(own, { message, stack: "at renderCard (bundle.e5f6a7b8.js:112:9)" });

    let rows: { fingerprint: string | null }[] = [];
    for (let attempt = 0; attempt < 20 && rows.length < 2; attempt++) {
      const result = await dbPool.query<{ fingerprint: string | null }>(
        `SELECT fingerprint FROM "${server.schema}".client_errors WHERE message = $1`,
        [message]
      );
      rows = result.rows;
      if (rows.length < 2) await new Promise((r) => setTimeout(r, 50));
    }

    assert.equal(rows.length, 2, "both reports were never stored");
    assert.ok(rows[0].fingerprint, "no fingerprint was computed");
    assert.equal(rows[0].fingerprint, rows[1].fingerprint);
  });

  test("a different crash gets a different fingerprint", async () => {
    const { cookie: own } = await register(server, "crash_fp_distinct");

    await postAs(own, { message: "first distinct crash", stack: "at a (x.ts:1:1)" });
    await postAs(own, { message: "second distinct crash", stack: "at b (y.ts:2:2)" });

    let rows: { message: string; fingerprint: string | null }[] = [];
    for (let attempt = 0; attempt < 20 && rows.length < 2; attempt++) {
      const result = await dbPool.query<{ message: string; fingerprint: string | null }>(
        `SELECT message, fingerprint FROM "${server.schema}".client_errors WHERE message IN ($1, $2)`,
        ["first distinct crash", "second distinct crash"]
      );
      rows = result.rows;
      if (rows.length < 2) await new Promise((r) => setTimeout(r, 50));
    }

    assert.equal(rows.length, 2, "both reports were never stored");
    assert.notEqual(rows[0].fingerprint, rows[1].fingerprint);
  });

  test("an oversized screen is refused", async () => {
    const { cookie: own } = await register(server, "crash_longscreen");
    const res = await postAs(own, { message: "boom", screen: "/" + "x".repeat(120) });
    assert.equal(res.status, 400);
  });

  // The floor under the rate-limit case below: one account burning its budget
  // must not silence another. The default express-rate-limit key is the IP, and
  // under it this test fails while every other one here still passes — an
  // office or a carrier NAT then shares five reports a minute between everyone
  // on it, during exactly the crash wave that makes reports worth having.
  test("one account's burst does not lock out another", async () => {
    const { cookie: noisy } = await register(server, "crash_noisy");
    const { cookie: quiet } = await register(server, "crash_quiet");

    for (let i = 0; i < 8; i++) await postAs(noisy, { message: `flood ${i}` });

    const res = await postAs(quiet, { message: "a first crash, from a different player" });
    assert.equal(res.status, 204, "a second account was rate limited by the first's burst");
  });

  test("a crash loop is rate limited rather than allowed to flood the log", async () => {
    const { cookie: loopCookie } = await register(server, "crash_looper");
    const statuses: number[] = [];
    for (let i = 0; i < 8; i++) {
      const res = await fetch(`${server.url}/api/client-errors`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: loopCookie },
        body: JSON.stringify({ message: `crash ${i}` }),
      });
      statuses.push(res.status);
    }
    assert.ok(
      statuses.includes(429),
      `expected a 429 once the burst limit is hit, got ${statuses.join(",")}`
    );
  });
});
