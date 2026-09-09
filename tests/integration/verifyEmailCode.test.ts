// tests/integration/verifyEmailCode.test.ts — #925: a 6-digit code is a
// 1,000,000-value space, brute-forceable within its TTL unless guesses
// against one outstanding code are capped. MAX_CODE_ATTEMPTS is that cap,
// enforced inside redeemAuthCode (server/authTokens.ts) — wrong guesses,
// an unknown email, and a code guessed wrong too many times must all answer
// with the same generic INVALID_TOKEN failure the token flow already used.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { startTestServer, hasDatabase, skipMessage, type TestServer } from "../helpers/testServer.ts";
import { register } from "../helpers/client.ts";

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

  // register() replies before minting (#897), so its own email_verify token
  // can land any time after — including after this test's own mint, whose
  // invalidatePendingAuthTokens+INSERT would then race register's identical
  // DELETE+INSERT chain. Waiting for register's row to exist first (same
  // poll as tests/integration/auth.test.ts's "mints exactly one" test) means
  // that chain has already finished before this test invalidates and mints
  // its own — no later DELETE can still be in flight to remove it.
  async function waitForPendingCode(userId: string): Promise<void> {
    const { db } = await import("../../server/db.ts");
    const { authTokens } = await import("../../shared/schema.ts");
    const { eq, and } = await import("drizzle-orm");
    for (let attempt = 0; attempt < 20; attempt++) {
      const rows = await db
        .select()
        .from(authTokens)
        .where(and(eq(authTokens.userId, userId), eq(authTokens.purpose, "email_verify")));
      if (rows.length > 0) return;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`register's background mint for ${userId} never landed`);
  }

  test("a wrong code fails with the generic failure", async () => {
    const { user } = await register(server, "code_wrong");
    await waitForPendingCode(user.id);
    const { mintAuthCode, invalidatePendingAuthTokens } = await import("../../server/authTokens.ts");
    await invalidatePendingAuthTokens(user.id, "email_verify");
    await mintAuthCode({ userId: user.id, email: user.email!, purpose: "email_verify", ttlMs: 60_000 });

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
    const { mintAuthCode, invalidatePendingAuthTokens, MAX_CODE_ATTEMPTS } = await import(
      "../../server/authTokens.ts"
    );
    await waitForPendingCode(user.id);
    await invalidatePendingAuthTokens(user.id, "email_verify");
    const code = await mintAuthCode({ userId: user.id, email: user.email!, purpose: "email_verify", ttlMs: 60_000 });

    // Wrong guesses, each guaranteed not to collide with the real code.
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < MAX_CODE_ATTEMPTS; i++) {
      const res = await verify(user.email!, wrong);
      assert.equal(res.status, 400, `attempt ${i}: ${await res.text()}`);
    }

    const { db } = await import("../../server/db.ts");
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

  test("a code minted for one account does not redeem for a different account, even with the right digits", async () => {
    const { user: alice } = await register(server, "code_salt_alice");
    const { user: bob } = await register(server, "code_salt_bob");
    const { mintAuthCode, redeemAuthCode, invalidatePendingAuthTokens } = await import(
      "../../server/authTokens.ts"
    );
    await waitForPendingCode(alice.id);
    await invalidatePendingAuthTokens(alice.id, "email_verify");
    const aliceCode = await mintAuthCode({
      userId: alice.id,
      email: alice.email!,
      purpose: "email_verify",
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
    const { mintAuthCode, invalidatePendingAuthTokens, MAX_CODE_ATTEMPTS } = await import(
      "../../server/authTokens.ts"
    );
    await waitForPendingCode(user.id);
    await invalidatePendingAuthTokens(user.id, "email_verify");
    const code = await mintAuthCode({ userId: user.id, email: user.email!, purpose: "email_verify", ttlMs: 60_000 });

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

    const { db } = await import("../../server/db.ts");
    const { users, authTokens } = await import("../../shared/schema.ts");
    const { eq } = await import("drizzle-orm");
    await waitForPendingCode(alice.id);
    await waitForPendingCode(bob.id);
    await waitForPendingCode(carol.id);
    await db.update(users).set({ email: sharedEmail, emailVerifiedAt: null }).where(eq(users.id, alice.id));
    await db.update(users).set({ email: sharedEmail, emailVerifiedAt: null }).where(eq(users.id, bob.id));

    const { mintAuthCode, invalidatePendingAuthTokens } = await import("../../server/authTokens.ts");
    await invalidatePendingAuthTokens(alice.id, "email_verify");
    await invalidatePendingAuthTokens(bob.id, "email_verify");
    await invalidatePendingAuthTokens(carol.id, "email_verify");
    const aliceCode = await mintAuthCode({
      userId: alice.id,
      email: sharedEmail,
      purpose: "email_verify",
      ttlMs: 60_000,
    });
    const bobCode = await mintAuthCode({ userId: bob.id, email: sharedEmail, purpose: "email_verify", ttlMs: 60_000 });
    await mintAuthCode({ userId: carol.id, email: carol.email!, purpose: "email_verify", ttlMs: 60_000 });

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
