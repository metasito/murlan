// tests/integration/resendVerification.test.ts — #893: POST
// /api/auth/resend-verification, the fix for the dead end an expired
// email_verify mint (24h TTL) leaves behind — add-email refuses a second
// call once an address is set (EMAIL_ALREADY_SET), so nothing else could
// mint a fresh one. Follows tests/integration/addEmail.test.ts for the
// harness shape.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { startTestServer, hasDatabase, skipMessage, type TestServer } from "../helpers/testServer.ts";
import { register } from "../helpers/client.ts";

describe("resend-verification", { skip: hasDatabase() ? false : skipMessage() }, () => {
  let server: TestServer;
  before(async () => { server = await startTestServer(); });
  after(async () => { if (server) await server.stop(); });

  function resend(cookie: string) {
    return fetch(`${server.url}/api/auth/resend-verification`, {
      method: "POST",
      headers: { cookie },
    });
  }

  // #861 requires an email at signup going forward, so an account with none
  // is simulated the same way tests/integration/addEmail.test.ts's
  // legacyAccount() does, rather than by registering (which always carries
  // one).
  async function legacyAccount(username: string) {
    const { user, cookie } = await register(server, username);
    const { db } = await import("../../server/db.ts");
    const { users } = await import("../../shared/schema.ts");
    const { eq } = await import("drizzle-orm");
    await db.update(users).set({ email: null, emailVerifiedAt: null }).where(eq(users.id, user.id));
    return { user, cookie };
  }

  test("an account with no address is refused", async () => {
    const { cookie } = await legacyAccount("resend_no_email");
    const res = await resend(cookie);
    const text = await res.text();
    assert.equal(res.status, 409, text);
    assert.equal(JSON.parse(text).code, "EMAIL_NOT_SET");
  });

  test("an already-verified account is refused", async () => {
    const { user, cookie } = await register(server, "resend_already_verified");
    const { storage } = await import("../../server/storage.ts");
    await storage.markEmailVerified(user.id);

    const res = await resend(cookie);
    const text = await res.text();
    assert.equal(res.status, 409, text);
    assert.equal(JSON.parse(text).code, "EMAIL_ALREADY_VERIFIED");
  });

  test("a signed-out request is rejected", async () => {
    const res = await resend("");
    assert.equal(res.status, 401);
  });

  test("a resend invalidates whatever email_verify token was pending, and mints exactly one fresh one", async () => {
    const { user, cookie } = await register(server, "resend_invalidates");
    const { mintAuthToken, redeemAuthToken } = await import("../../server/authTokens.ts");

    // Stands in for the token register() already minted in the background —
    // the same technique tests/integration/addEmail.test.ts's own
    // invalidation test uses, so this assertion cannot race register()'s own
    // fire-and-forget mint: whichever token is live when resend runs, the
    // route's own invalidate-then-mint clears every pending row regardless.
    const pending = await mintAuthToken(user.id, "email_verify", 60_000);

    const res = await resend(cookie);
    assert.equal(res.status, 200, await res.text());

    const stalePending = await redeemAuthToken(pending, "email_verify");
    assert.equal(stalePending, null, "resend must invalidate whatever was pending before it");

    const { db } = await import("../../server/db.ts");
    const { authTokens } = await import("../../shared/schema.ts");
    const { eq, and } = await import("drizzle-orm");
    const rows = await db
      .select()
      .from(authTokens)
      .where(and(eq(authTokens.userId, user.id), eq(authTokens.purpose, "email_verify")));
    assert.equal(rows.length, 1, "resend must leave exactly one email_verify token for the account");
    assert.equal(rows[0]!.usedAt, null, "the surviving token must be the fresh, unredeemed one");
  });
});
