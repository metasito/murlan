// tests/integration/addEmail.test.ts — #863, the existing-account email
// migration nudge: an account that predates the email requirement
// (`email IS NULL`) adds and verifies one, per docs/superpowers/specs/
// 2026-09-03-account-recovery-design.md, Box 1.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { startTestServer, hasDatabase, skipMessage, type TestServer } from "../helpers/testServer.ts";
import { register } from "../helpers/client.ts";

describe("add-email migration nudge", { skip: hasDatabase() ? false : skipMessage() }, () => {
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

  function me(cookie: string) {
    return fetch(`${server.url}/api/auth/me`, { headers: { cookie } });
  }

  /**
   * register() always sends an email now (#861 requires one at signup), so a
   * pre-#861 beta account — `email IS NULL` — is simulated the same way the
   * design doc frames it: an existing row this ticket never touches at
   * signup time, only afterwards.
   */
  async function legacyAccount(username: string) {
    const { user, cookie } = await register(server, username);
    const { db } = await import("../../server/db.ts");
    const { users, authTokens } = await import("../../shared/schema.ts");
    const { eq } = await import("drizzle-orm");
    await db.update(users).set({ email: null, emailVerifiedAt: null }).where(eq(users.id, user.id));
    // register() already minted its own email_verify token; a real legacy
    // account predates that flow entirely, so drop it rather than count it
    // alongside the one add-email mints.
    await db.delete(authTokens).where(eq(authTokens.userId, user.id));
    return { user, cookie };
  }

  test("an account with no email can add one, and it mints exactly one email_verify token", async () => {
    const { user, cookie } = await legacyAccount("nudge_add");
    const res = await addEmail(cookie, "nudge_add@example.test");
    const text = await res.text();
    assert.equal(res.status, 200, text);
    const body = JSON.parse(text);
    assert.equal(body.email, "nudge_add@example.test");
    assert.equal(body.emailVerified, false);

    const { db } = await import("../../server/db.ts");
    const { authTokens } = await import("../../shared/schema.ts");
    const { eq, and } = await import("drizzle-orm");
    const rows = await db
      .select()
      .from(authTokens)
      .where(and(eq(authTokens.userId, user.id), eq(authTokens.purpose, "email_verify")));
    assert.equal(rows.length, 1, "add-email must mint exactly one email_verify token");
    assert.equal(rows[0]!.usedAt, null);
  });

  test("the minted token redeems through the same /api/auth/verify-email route signup uses — no second endpoint", async () => {
    const { user, cookie } = await legacyAccount("nudge_reuse");
    const addRes = await addEmail(cookie, "nudge_reuse@example.test");
    assert.equal(addRes.status, 200, await addRes.text());

    // The raw token is only ever mailed, never returned in the response (same
    // as register's own mint) — mint an equivalent one directly to drive the
    // shared redemption path add-email's mint call feeds in production.
    const { mintAuthToken, redeemAuthToken } = await import("../../server/authTokens.ts");
    const token = await mintAuthToken(user.id, "email_verify", 60_000);

    const verifyRes = await fetch(`${server.url}/api/auth/verify-email`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });
    assert.equal(verifyRes.status, 200, await verifyRes.text());

    const meRes = await me(cookie);
    const meBody = await meRes.json();
    assert.equal(meBody.emailVerified, true, "verify-email must be the route that flips emailVerifiedAt for an added email too");

    const direct = await redeemAuthToken(token, "email_verify");
    assert.equal(direct, null, "the token must be single-use through the shared redeem path");
  });

  test("submitting an email already taken by another account is refused, and changes nothing", async () => {
    await register(server, "nudge_owner");
    const { cookie } = await legacyAccount("nudge_dup");
    const res = await addEmail(cookie, "NUDGE_OWNER@Example.Test");
    const text = await res.text();
    assert.equal(res.status, 409, text);
    assert.equal(JSON.parse(text).code, "EMAIL_TAKEN");

    const meRes = await me(cookie);
    const meBody = await meRes.json();
    assert.equal(meBody.email, null, "a refused add-email must leave the account's own email untouched");
  });

  test("an account that already has an email cannot overwrite it through this endpoint", async () => {
    const { cookie } = await register(server, "nudge_already_set");
    const res = await addEmail(cookie, "nudge_takeover@example.test");
    const text = await res.text();
    assert.equal(res.status, 409, text);
    assert.equal(JSON.parse(text).code, "EMAIL_ALREADY_SET");
  });

  test("a signed-out request is rejected", async () => {
    const res = await addEmail("", "nobody@example.test");
    assert.equal(res.status, 401);
  });
});
