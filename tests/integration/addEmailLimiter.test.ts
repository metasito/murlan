// tests/integration/addEmailLimiter.test.ts — #894 review, finding 4:
// storage.setEmail no longer raises EmailTakenError for an address
// claimed-but-unverified elsewhere (#897), so any authenticated account can
// send one verification mail to any address, including a verified victim's.
// Capped at one send per *account* by EMAIL_ALREADY_SET, but an attacker
// with several accounts could still mail one address repeatedly with no
// route-level bound — addEmailLimiter closes that per address, mirroring
// registerEmailLimiter.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { startTestServer, hasDatabase, skipMessage, type TestServer } from "../helpers/testServer.ts";
import { register } from "../helpers/client.ts";

describe("add-email is rate limited per address", { skip: hasDatabase() ? false : skipMessage() }, () => {
  let server: TestServer;
  before(async () => { server = await startTestServer(); });
  after(async () => { if (server) await server.stop(); });

  function addEmail(cookie: string, email: string) {
    return fetch(`${server.url}/api/auth/add-email`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ email }),
    });
  }

  // #861 requires an email at signup going forward, so a real target for
  // this route (`email IS NULL`) is a pre-#861 account — simulated the same
  // way tests/integration/addEmail.test.ts's legacyAccount() does, rather
  // than by registering (which always carries one).
  async function legacyAccount(username: string) {
    const { user, cookie } = await register(server, username);
    const { db } = await import("../../server/db.ts");
    const { users } = await import("../../shared/schema.ts");
    const { eq } = await import("drizzle-orm");
    await db.update(users).set({ email: null, emailVerifiedAt: null }).where(eq(users.id, user.id));
    return { user, cookie };
  }

  test("repeated add-email calls targeting the same address trip the limiter, a different address does not", async () => {
    const target = "addemaillimiter_shared@example.test";

    // MURLAN_ADD_EMAIL_RATE_LIMIT=5 in tests/helpers/testServer.ts. A fresh
    // account each time — EMAIL_ALREADY_SET caps any one account to a single
    // successful call, so a single account could never exercise this on its
    // own; the limiter is what bounds several accounts aiming at one address.
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const { cookie } = await legacyAccount(`add_email_limit_user_${i}`);
      statuses.push((await addEmail(cookie, target)).status);
    }
    assert.ok(
      statuses.includes(429),
      `expected addEmailLimiter to trip within six requests, got ${statuses.join(", ")}`
    );

    // Keyed on the target address, not the account or the IP: a different
    // address must still be accepted inside the same window.
    const { cookie } = await legacyAccount("add_email_limit_other_user");
    const res = await addEmail(cookie, "addemaillimiter_other@example.test");
    assert.equal(res.status, 200, await res.text());
  });
});
