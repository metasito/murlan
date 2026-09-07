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

  test("a wrong code fails with the generic failure", async () => {
    const { user } = await register(server, "code_wrong");
    const { mintAuthCode } = await import("../../server/authTokens.ts");
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
    const { mintAuthCode, redeemAuthCode, MAX_CODE_ATTEMPTS } = await import("../../server/authTokens.ts");
    const code = await mintAuthCode(user.id, user.email!, "email_verify", 60_000);

    // Wrong guesses, each guaranteed not to collide with the real code.
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < MAX_CODE_ATTEMPTS; i++) {
      const res = await verify(user.email!, wrong);
      assert.equal(res.status, 400, `attempt ${i}: ${await res.text()}`);
    }

    const direct = await redeemAuthCode(user.email!, "email_verify", code);
    assert.equal(direct, null, "the correct code must stop redeeming once MAX_CODE_ATTEMPTS wrong guesses have run");
  });

  test("fewer than MAX_CODE_ATTEMPTS wrong guesses still allow the right code through", async () => {
    const { user } = await register(server, "code_recovers");
    const { mintAuthCode, MAX_CODE_ATTEMPTS } = await import("../../server/authTokens.ts");
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
