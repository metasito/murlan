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

  // Every test below mints its own code right after register() — which
  // already minted one in the background (fire-and-forget, same technique
  // tests/integration/resendVerification.test.ts documents). Clearing
  // whatever that mint left first keeps this test's own code the only
  // pending row, so a late-arriving background mint can't null it out from
  // under an in-flight assertion.
  test("a wrong code fails with the generic failure", async () => {
    const { user } = await register(server, "code_wrong");
    const { mintAuthCode, invalidatePendingAuthTokens } = await import("../../server/authTokens.ts");
    await invalidatePendingAuthTokens(user.id, "email_verify");
    await mintAuthCode(user.id, user.email!, "email_verify", 60_000);

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
    await invalidatePendingAuthTokens(user.id, "email_verify");
    const code = await mintAuthCode(user.id, user.email!, "email_verify", 60_000);

    // Wrong guesses, each guaranteed not to collide with the real code.
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < MAX_CODE_ATTEMPTS; i++) {
      const res = await verify(user.email!, wrong);
      assert.equal(res.status, 400, `attempt ${i}: ${await res.text()}`);
    }

    const { db } = await import("../../server/db.ts");
    const { authTokens } = await import("../../shared/schema.ts");
    const { eq } = await import("drizzle-orm");
    const [row] = await db.select().from(authTokens).where(eq(authTokens.userId, user.id));
    assert.ok(
      (row?.attempts ?? 0) >= MAX_CODE_ATTEMPTS,
      `the row's own attempts counter must reach the cap, got ${row?.attempts}`
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
    await invalidatePendingAuthTokens(alice.id, "email_verify");
    const aliceCode = await mintAuthCode(alice.id, alice.email!, "email_verify", 60_000);

    // If the hash were salted by code alone (no email), this would still
    // match alice's own row and return her userId — the email argument
    // naming bob wouldn't matter at all.
    const crossRedeem = await redeemAuthCode(bob.email!, "email_verify", aliceCode);
    assert.equal(crossRedeem, null, "alice's code must not verify bob's account");

    const res = await verify(alice.email!, aliceCode);
    assert.equal(res.status, 200, await res.text());
  });

  test("fewer than MAX_CODE_ATTEMPTS wrong guesses still allow the right code through", async () => {
    const { user } = await register(server, "code_recovers");
    const { mintAuthCode, invalidatePendingAuthTokens, MAX_CODE_ATTEMPTS } = await import(
      "../../server/authTokens.ts"
    );
    await invalidatePendingAuthTokens(user.id, "email_verify");
    const code = await mintAuthCode(user.id, user.email!, "email_verify", 60_000);

    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < MAX_CODE_ATTEMPTS - 1; i++) {
      const res = await verify(user.email!, wrong);
      assert.equal(res.status, 400, `attempt ${i}: ${await res.text()}`);
    }

    const res = await verify(user.email!, code);
    assert.equal(res.status, 200, await res.text());
  });
});
