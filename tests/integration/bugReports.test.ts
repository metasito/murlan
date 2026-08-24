// tests/integration/bugReports.test.ts — the bug-report endpoint.
//
// A player's own words, taken by an authenticated route and written to a
// table. Free text from a client is the same hazard here as in
// clientErrors.test.ts: unbounded it fills a disk, unauthenticated it is open
// log injection, unlimited it is an abuse surface. Every limit is asserted by
// **exceeding** it against the real server — a test that stays inside a cap
// proves only that the happy path works.
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

/**
 * The caps, written out rather than imported from `server/bugReports.ts`, for
 * two reasons.
 *
 * Importing them would drag in `server/db.ts`, whose Pool is built at module
 * scope from `DATABASE_URL` — read before `startTestServer` scopes it. The app
 * would then create its tables in the default schema instead of the throwaway
 * one, and this suite would write real rows into whatever database the
 * variable points at, with `stop()` dropping an empty schema.
 *
 * And a cap read from the thing it is checking cannot fail: raise the constant
 * and `cap + 1` rises with it. Written out, drift fails here — the same reason
 * `clientErrors.test.ts` spells its own out.
 */
const CAP = { description: 2000, screen: 200 } as const;

describe("bug reports", { skip: hasDatabase() ? false : skipMessage() }, () => {
  let server: TestServer;
  // Four accounts, not one. `errorReportLimiter` allows five posts a minute
  // per account and counts rejected ones too, so a single cookie would spend
  // its budget on the cap tests and hand the next one a 429 where it expects a
  // 400 — a test that passes for the wrong reason if it expects 4xx loosely.
  // Two cap accounts rather than one for the same reason: four rejections
  // against a limit of five is a margin of one, which is not a margin.
  let cookie: string;
  let capCookie: string;
  let capCookie2: string;
  let dbPool: pg.Pool;
  // Unique per run: the suite must be runnable twice against the same
  // database without the second run failing on USERNAME_TAKEN.
  const suffix = `${Date.now()}`.slice(-8);

  before(async () => {
    server = await startTestServer();
    ({ cookie } = await register(server, `bug_reporter_${suffix}`));
    ({ cookie: capCookie } = await register(server, `bug_caps_${suffix}`));
    ({ cookie: capCookie2 } = await register(server, `bug_caps2_${suffix}`));
    dbPool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  });
  after(async () => {
    await dbPool.end();
    await server.stop();
  });

  function post(body: unknown, as: string | null = cookie) {
    return fetch(`${server.url}/api/bug-reports`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(as ? { cookie: as } : {}),
      },
      body: JSON.stringify(body),
    });
  }

  test("a report is stored, with the context the client sent", async () => {
    const description = `the cards went weird ${Date.now()}`;
    const res = await post({
      description,
      screen: "/game",
      appVersion: "1.2.3",
      platform: "ios",
      locale: "sq",
    });
    assert.equal(res.status, 201);

    const { rows } = await dbPool.query(
      `SELECT description, screen, app_version, platform, locale, resolved
         FROM "${server.schema}".bug_reports WHERE description = $1`,
      [description]
    );
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0], {
      description,
      screen: "/game",
      app_version: "1.2.3",
      platform: "ios",
      locale: "sq",
      resolved: false,
    });
  });

  test("an anonymous report is refused", async () => {
    const res = await post({ description: "not signed in" }, null);
    assert.equal(res.status, 401);
  });

  // The caps, each proven one character past its limit rather than inside it.
  test("a description longer than the cap is refused", async () => {
    const res = await post({ description: "x".repeat(CAP.description + 1) }, capCookie);
    assert.equal(res.status, 400);
    assert.equal((await res.json()).code, "INVALID_PAYLOAD");
  });

  test("a description at the cap is accepted, so the cap is not off by one", async () => {
    const res = await post({ description: "y".repeat(CAP.description) });
    assert.equal(res.status, 201);
  });

  test("an over-long screen is refused", async () => {
    const res = await post(
      { description: "fine", screen: "/".repeat(CAP.screen + 1) },
      capCookie
    );
    assert.equal(res.status, 400);
  });

  test("an empty description is refused", async () => {
    assert.equal((await post({ description: "   " }, capCookie2)).status, 400);
  });

  test("a platform outside the known set is refused", async () => {
    const res = await post({ description: "fine", platform: "blackberry" }, capCookie2);
    assert.equal(res.status, 400);
  });

  // Last, because it spends this account's whole budget for the window.
  test("the rate limit trips when it is exceeded", async () => {
    const { cookie: spender } = await register(server, `bug_spammer_${suffix}`);
    const statuses: number[] = [];
    // errorReportLimiter allows 5 a minute per account; ten is past it twice
    // over, so this cannot pass by the limiter merely being slow.
    for (let i = 0; i < 10; i++) {
      statuses.push((await post({ description: `spam ${i}` }, spender)).status);
    }
    assert.ok(
      statuses.includes(429),
      `expected the limiter to trip within ten posts, got ${statuses.join(", ")}`
    );
    assert.equal(statuses[0], 201, "the first report must still be accepted");
  });
});
