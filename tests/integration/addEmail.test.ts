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
    // alongside the one add-email mints. Registration replies *before* that
    // mint (server/routes.ts, so a provider outage cannot delay the reply),
    // so the row is not there yet when register() resolves — deleting without
    // waiting for it leaves it to land afterwards and be counted.
    const deadline = Date.now() + 5_000;
    for (;;) {
      const rows = await db.select().from(authTokens).where(eq(authTokens.userId, user.id));
      if (rows.length > 0) break;
      assert.ok(Date.now() < deadline, "register never minted the token this account has to shed");
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
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

  // #900 review: two live email_verify codes for one user is the
  // precondition for an address-takeover escalation — redeem one and lose
  // the race (email cleared to NULL), then add-email a different address
  // and redeem the still-live second one, verifying an address never
  // proven. Exercised directly against authTokens.ts rather than through
  // the race above, so this fails on the mechanism regressing even if the
  // race that first surfaced it never reproduces.
  test("minting a second email_verify code invalidates the first, unconditionally", async () => {
    const { user } = await register(server, "nudge_invalidate");
    const { mintAuthCode, redeemAuthCode, invalidatePendingAuthTokens } = await import(
      "../../server/authTokens.ts"
    );
    const email = user.email!;

    const first = await mintAuthCode({ userId: user.id, email, purpose: "email_verify", ttlMs: 60_000 });
    await invalidatePendingAuthTokens(user.id, "email_verify");
    const second = await mintAuthCode({ userId: user.id, email, purpose: "email_verify", ttlMs: 60_000 });

    const redeemedFirst = await redeemAuthCode({ email, purpose: "email_verify", code: first });
    assert.equal(redeemedFirst, null, "an outstanding sibling code must not survive a fresh mint");

    const redeemedSecond = await redeemAuthCode({ email, purpose: "email_verify", code: second });
    assert.equal(redeemedSecond, user.id, "the latest mint must still redeem normally");
  });

  test("the minted code redeems through the same /api/auth/verify-email route signup uses — no second endpoint", async () => {
    const { user, cookie } = await legacyAccount("nudge_reuse");
    const email = "nudge_reuse@example.test";
    const addRes = await addEmail(cookie, email);
    assert.equal(addRes.status, 200, await addRes.text());

    // The raw code is only ever mailed, never returned in the response (same
    // as register's own mint) — mint an equivalent one directly to drive the
    // shared redemption path add-email's mint call feeds in production.
    const { mintAuthCode, redeemAuthCode } = await import("../../server/authTokens.ts");
    const code = await mintAuthCode({ userId: user.id, email, purpose: "email_verify", ttlMs: 60_000 });

    const verifyRes = await fetch(`${server.url}/api/auth/verify-email`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, code }),
    });
    assert.equal(verifyRes.status, 200, await verifyRes.text());

    const meRes = await me(cookie);
    const meBody = await meRes.json();
    assert.equal(meBody.emailVerified, true, "verify-email must be the route that flips emailVerifiedAt for an added email too");

    const direct = await redeemAuthCode({ email, purpose: "email_verify", code });
    assert.equal(direct, null, "the code must be single-use through the shared redeem path");
  });

  // #897: an unverified email is a claim, not a possession
  // (users_email_verified_lower_uq, shared/schema.ts) — setEmail only ever
  // touches this account's own row, never the other one's emailVerifiedAt,
  // so the partial index has nothing to enforce here regardless of whether
  // the address is already taken, verified or not. The conflict this used
  // to catch at add-email time now surfaces at verify-email time instead —
  // see the two tests below.
  test("submitting an email already claimed (unverified) elsewhere succeeds — it is a second claim, not a takeover", async () => {
    await register(server, "nudge_owner");
    const { cookie } = await legacyAccount("nudge_dup");
    const res = await addEmail(cookie, "NUDGE_OWNER@Example.Test");
    const text = await res.text();
    assert.equal(res.status, 200, text);
    assert.equal(JSON.parse(text).email, "NUDGE_OWNER@Example.Test");

    const meRes = await me(cookie);
    const meBody = await meRes.json();
    assert.equal(meBody.email, "NUDGE_OWNER@Example.Test");
    assert.equal(meBody.emailVerified, false);
  });

  test("verifying a claim against an address already verified elsewhere is refused, and clears this account's email", async () => {
    const { user: owner, cookie: ownerCookie } = await register(server, "nudge_verified_owner");
    const { mintAuthCode } = await import("../../server/authTokens.ts");
    const ownerCode = await mintAuthCode({
      userId: owner.id,
      email: owner.email!,
      purpose: "email_verify",
      ttlMs: 60_000,
    });
    const ownerVerify = await fetch(`${server.url}/api/auth/verify-email`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: owner.email, code: ownerCode }),
    });
    assert.equal(ownerVerify.status, 200, await ownerVerify.text());

    const { user: claimant, cookie } = await legacyAccount("nudge_race");
    const claimedEmail = "NUDGE_VERIFIED_OWNER@Example.Test";
    const addRes = await addEmail(cookie, claimedEmail);
    assert.equal(
      addRes.status,
      200,
      `claiming it is still allowed — only verifying it isn't: ${await addRes.text()}`
    );

    // Same reason register()'s and legacyAccount()'s own callers do this
    // rather than reading a stored code back: only its hash is persisted.
    const claimCode = await mintAuthCode({
      userId: claimant.id,
      email: claimedEmail,
      purpose: "email_verify",
      ttlMs: 60_000,
    });

    const verifyRes = await fetch(`${server.url}/api/auth/verify-email`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: claimedEmail, code: claimCode }),
    });
    const verifyText = await verifyRes.text();
    assert.equal(verifyRes.status, 409, verifyText);
    assert.equal(JSON.parse(verifyText).code, "EMAIL_VERIFIED_ELSEWHERE");

    const meRes = await me(cookie);
    const meBody = await meRes.json();
    assert.equal(meBody.email, null, "the losing claim's email must be cleared, not left colliding");

    const ownerMeRes = await me(ownerCookie);
    const ownerMeBody = await ownerMeRes.json();
    assert.equal(ownerMeBody.emailVerified, true, "the first verifier keeps the address");
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
