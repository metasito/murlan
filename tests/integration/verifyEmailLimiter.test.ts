// tests/integration/verifyEmailLimiter.test.ts — #892: /api/auth/verify-email
// carried no rate limiter at all, unlike every other public auth route.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { startTestServer, hasDatabase, skipMessage, type TestServer } from "../helpers/testServer.ts";

describe("verify-email is rate limited", { skip: hasDatabase() ? false : skipMessage() }, () => {
  let server: TestServer;
  const suiteBudget = process.env.MURLAN_AUTH_RATE_LIMIT;
  before(async () => {
    server = await startTestServer();
    // After the routes are imported and their limiters built: a limit is read when a request is limited.
    process.env.MURLAN_AUTH_RATE_LIMIT = "5";
  });
  after(async () => {
    if (suiteBudget === undefined) delete process.env.MURLAN_AUTH_RATE_LIMIT;
    else process.env.MURLAN_AUTH_RATE_LIMIT = suiteBudget;
    if (server) await server.stop();
  });

  test("repeated requests trip authLimiter", async () => {
    const statuses: number[] = [];
    let limited: { code: string } | undefined;
    for (let i = 0; i < 6; i++) {
      const res = await fetch(`${server.url}/api/auth/verify-email`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: `not-a-real-${i}@example.test`, code: "000000" }),
      });
      statuses.push(res.status);
      if (res.status === 429) limited = (await res.json()) as { code: string };
    }
    assert.ok(
      statuses.includes(429),
      `expected authLimiter to trip within six requests, got ${statuses.join(", ")}`
    );
    assert.equal(limited?.code, "AUTH_RATE_LIMITED");
  });
});
