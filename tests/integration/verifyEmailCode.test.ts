// tests/integration/verifyEmailCode.test.ts — #925: a 6-digit code is a
// 1,000,000-value space, brute-forceable within its TTL unless guesses
// against one outstanding code are capped. MAX_CODE_ATTEMPTS is that cap,
// enforced inside redeemAuthCode (server/http/authTokens.ts) — wrong guesses,
// an unknown email, and a code guessed wrong too many times must all answer
// with the same generic INVALID_TOKEN failure the token flow already used.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { startTestServer, hasDatabase, skipMessage, type TestServer } from "../helpers/testServer.ts";
import { register, waitForPendingCode } from "../helpers/client.ts";

describe("verify-email code guessing is capped per credential", { skip: hasDatabase() ? false : skipMessage() }, () => {
  let server: TestServer;
  before(async () => { server = await startTestServer(); });
  after(async () => { if (server) await server.stop(); });

  function verify(email: string, code: string) {
    return fetch(`${server.url}/api/auth/verify-email`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, code }),
    });
  }

  test("a wrong code fails with the generic failure", async () => {
    const { user } = await register(server, "code_wrong");
    await waitForPendingCode(user.id);
    const { replaceEmailVerifyCode } = await import("../../server/http/authTokens.ts");
    await replaceEmailVerifyCode({ userId: user.id, email: user.email!, ttlMs: 60_000 });

    const res = await verify(user.email!, "000000");
    const text = await res.text();
    assert.equal(res.status, 400, text);
    assert.equal(JSON.parse(text).code, "INVALID_TOKEN");
  });

  test("an unknown email fails with the same generic failure", async () => {
    const res = await verify("nobody-registered@example.test", "123456");
    const text = await res.text();
    assert.equal(res.status, 400, text);
    assert.equal(JSON.parse(text).code, "INVALID_TOKEN");
  });

  test("MAX_CODE_ATTEMPTS wrong guesses force a resend — the right code stops working before its TTL runs out", async () => {
    const { user } = await register(server, "code_capped");
    const { replaceEmailVerifyCode, MAX_CODE_ATTEMPTS } = await import(
      "../../server/http/authTokens.ts"
    );
    await waitForPendingCode(user.id);
    const code = await replaceEmailVerifyCode({ userId: user.id, email: user.email!, ttlMs: 60_000 });

    // Wrong guesses, each guaranteed not to collide with the real code.
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < MAX_CODE_ATTEMPTS; i++) {
      const res = await verify(user.email!, wrong);
      assert.equal(res.status, 400, `attempt ${i}: ${await res.text()}`);
    }

    const { db } = await import("../../server/store/db.ts");
    const { authTokens } = await import("../../shared/schema.ts");
    const { eq } = await import("drizzle-orm");
    const rows = await db.select().from(authTokens).where(eq(authTokens.userId, user.id));
    assert.equal(rows.length, 1, "a late background mint would leave a second, untouched row here");
    assert.ok(
      (rows[0]?.attempts ?? 0) >= MAX_CODE_ATTEMPTS,
      `the row's own attempts counter must reach the cap, got ${rows[0]?.attempts}`
    );

    const finalTry = await verify(user.email!, code);
    const finalText = await finalTry.text();
    assert.equal(finalTry.status, 400, finalText);
    assert.equal(JSON.parse(finalText).code, "INVALID_TOKEN");
  });

  test("a resend does not hand back a fresh five guesses", async () => {
    const { user } = await register(server, "code_resend_cap");
    const { replaceEmailVerifyCode, MAX_CODE_ATTEMPTS } = await import("../../server/http/authTokens.ts");
    await waitForPendingCode(user.id);
    const first = await replaceEmailVerifyCode({ userId: user.id, email: user.email!, ttlMs: 60_000 });

    const wrong = first === "000000" ? "111111" : "000000";
    for (let i = 0; i < MAX_CODE_ATTEMPTS; i++) {
      assert.equal((await verify(user.email!, wrong)).status, 400, `attempt ${i}`);
    }

    const second = await replaceEmailVerifyCode({ userId: user.id, email: user.email!, ttlMs: 60_000 });
    const res = await verify(user.email!, second);
    const text = await res.text();
    assert.equal(res.status, 400, `the resent code redeemed past the cap: ${text}`);
    assert.equal(JSON.parse(text).code, "INVALID_TOKEN");
  });

  test("a code that outlived its TTL carries nothing onto its replacement", async () => {
    const { user } = await register(server, "code_resend_expired");
    const { replaceEmailVerifyCode, MAX_CODE_ATTEMPTS } = await import("../../server/http/authTokens.ts");
    const { db } = await import("../../server/store/db.ts");
    const { authTokens } = await import("../../shared/schema.ts");
    const { eq } = await import("drizzle-orm");
    await waitForPendingCode(user.id);
    await replaceEmailVerifyCode({ userId: user.id, email: user.email!, ttlMs: 60_000 });
    await db
      .update(authTokens)
      .set({ attempts: MAX_CODE_ATTEMPTS, expiresAt: new Date(Date.now() - 1000) })
      .where(eq(authTokens.userId, user.id));

    const fresh = await replaceEmailVerifyCode({ userId: user.id, email: user.email!, ttlMs: 60_000 });
    const res = await verify(user.email!, fresh);
    assert.equal(res.status, 200, await res.text());
  });

  test("a code minted for one account does not redeem for a different account, even with the right digits", async () => {
    const { user: alice } = await register(server, "code_salt_alice");
    const { user: bob } = await register(server, "code_salt_bob");
    const { replaceEmailVerifyCode, redeemAuthCode } = await import(
      "../../server/http/authTokens.ts"
    );
    await waitForPendingCode(alice.id);
    const aliceCode = await replaceEmailVerifyCode({
      userId: alice.id,
      email: alice.email!,
      ttlMs: 60_000,
    });

    // If the hash were salted by code alone (no email), this would still
    // match alice's own row and return her userId — the email argument
    // naming bob wouldn't matter at all.
    const crossRedeem = await redeemAuthCode({ email: bob.email!, purpose: "email_verify", code: aliceCode });
    assert.equal(crossRedeem, null, "alice's code must not verify bob's account");

    const res = await verify(alice.email!, aliceCode);
    assert.equal(res.status, 200, await res.text());
  });

  test("fewer than MAX_CODE_ATTEMPTS wrong guesses still allow the right code through", async () => {
    const { user } = await register(server, "code_recovers");
    const { replaceEmailVerifyCode, MAX_CODE_ATTEMPTS } = await import(
      "../../server/http/authTokens.ts"
    );
    await waitForPendingCode(user.id);
    const code = await replaceEmailVerifyCode({ userId: user.id, email: user.email!, ttlMs: 60_000 });

    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < MAX_CODE_ATTEMPTS - 1; i++) {
      const res = await verify(user.email!, wrong);
      assert.equal(res.status, 400, `attempt ${i}: ${await res.text()}`);
    }

    const res = await verify(user.email!, code);
    assert.equal(res.status, 200, await res.text());
  });

  // The partial unique index only covers verified addresses, so several
  // unverified accounts may share one. A miss must still charge every
  // pending row at that address, not just the first match — and no others.
  test("a miss charges every unverified account sharing the guessed address, and no other account", async () => {
    const { user: alice } = await register(server, "code_shared_alice");
    const { user: bob } = await register(server, "code_shared_bob");
    const { user: carol } = await register(server, "code_shared_carol");
    const sharedEmail = "code_shared@example.test";

    const { db } = await import("../../server/store/db.ts");
    const { users, authTokens } = await import("../../shared/schema.ts");
    const { eq } = await import("drizzle-orm");
    await waitForPendingCode(alice.id);
    await waitForPendingCode(bob.id);
    await waitForPendingCode(carol.id);
    await db.update(users).set({ email: sharedEmail, emailVerifiedAt: null }).where(eq(users.id, alice.id));
    await db.update(users).set({ email: sharedEmail, emailVerifiedAt: null }).where(eq(users.id, bob.id));

    const { replaceEmailVerifyCode } = await import("../../server/http/authTokens.ts");
    const aliceCode = await replaceEmailVerifyCode({
      userId: alice.id,
      email: sharedEmail,
      ttlMs: 60_000,
    });
    const bobCode = await replaceEmailVerifyCode({ userId: bob.id, email: sharedEmail, ttlMs: 60_000 });
    await replaceEmailVerifyCode({ userId: carol.id, email: carol.email!, ttlMs: 60_000 });

    const wrong = [aliceCode, bobCode].includes("000000") ? "111111" : "000000";
    const res = await verify(sharedEmail, wrong);
    assert.equal(res.status, 400, await res.text());

    const rows = await db.select().from(authTokens).where(eq(authTokens.purpose, "email_verify"));
    const aliceRow = rows.find((row) => row.userId === alice.id);
    const bobRow = rows.find((row) => row.userId === bob.id);
    const carolRow = rows.find((row) => row.userId === carol.id);
    assert.equal(aliceRow?.attempts, 1, "alice's pending row must be charged too");
    assert.equal(bobRow?.attempts, 1, "bob's pending row must be charged too");
    assert.equal(carolRow?.attempts, 0, "a miss at one address must not charge an unrelated account's row");
  });
});
