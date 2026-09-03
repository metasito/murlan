// tests/integration/registerEmailLimiter.test.ts — #892 (c): registration
// now sends mail to an arbitrary address on demand (#897), which is an
// amplification vector authLimiter's per-IP ceiling alone does not close.
// registerEmailLimiter keys on the submitted address instead.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { startTestServer, hasDatabase, skipMessage, type TestServer } from "../helpers/testServer.ts";

describe("register is rate limited per address", { skip: hasDatabase() ? false : skipMessage() }, () => {
  let server: TestServer;
  before(async () => { server = await startTestServer(); });
  after(async () => { if (server) await server.stop(); });

  function register(username: string, email: string) {
    return fetch(`${server.url}/api/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password: "password123", email }),
    });
  }

  test("repeated registrations to the same address trip the limiter, a different address does not", async () => {
    const address = "registeremaillimiter_shared@example.test";

    // MURLAN_REGISTER_EMAIL_RATE_LIMIT=5 in tests/helpers/testServer.ts.
    // A distinct username each time, so USERNAME_TAKEN never masks the
    // address-keyed limiter tripping.
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      statuses.push((await register(`register_limit_user_${i}`, address)).status);
    }
    assert.ok(
      statuses.includes(429),
      `expected registerEmailLimiter to trip within six requests, got ${statuses.join(", ")}`
    );

    // Keyed on the address, not the IP: a different address from the same
    // caller must still be accepted inside the same window.
    const res = await register("register_limit_other_user", "registeremaillimiter_other@example.test");
    assert.equal(res.status, 200, await res.text());
  });
});
