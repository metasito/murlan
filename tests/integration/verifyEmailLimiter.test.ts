// tests/integration/verifyEmailLimiter.test.ts — #892: /api/auth/verify-email
// carried no rate limiter at all, unlike every other public auth route.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { startTestServer, hasDatabase, skipMessage, type TestServer } from "../helpers/testServer.ts";

/**
 * Its own file so this can be lowered just for this process — the shared
 * budget everywhere else (tests/helpers/testServer.ts) is sized for a whole
 * suite's worth of registrations and would need hundreds of requests to trip
 * here. Set after the imports above (none of which reaches server/routes.ts
 * — see testServer.ts's own note on why) but before startTestServer() below
 * dynamically imports it.
 */
process.env.MURLAN_AUTH_RATE_LIMIT = "5";

describe("verify-email is rate limited", { skip: hasDatabase() ? false : skipMessage() }, () => {
  let server: TestServer;
  before(async () => { server = await startTestServer(); });
  after(async () => { if (server) await server.stop(); });

  test("repeated requests trip authLimiter", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await fetch(`${server.url}/api/auth/verify-email`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: `not-a-real-token-${i}` }),
      });
      statuses.push(res.status);
    }
    assert.ok(
      statuses.includes(429),
      `expected authLimiter to trip within six requests, got ${statuses.join(", ")}`
    );
  });
});
