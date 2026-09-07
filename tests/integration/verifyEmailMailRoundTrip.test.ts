// tests/integration/verifyEmailMailRoundTrip.test.ts — #925's Definition of
// done asks for a signup that "lands verified end to end (mocking or
// stubbing sendMail locally)". Every other verify-email test mints its own
// code directly against server/authTokens.ts, bypassing register()'s own
// fire-and-forget mint entirely — a salt mismatch between what register()
// mails and what verify-email checks would pass all of them. This drives
// the real mail path instead, through the same MURLAN_MAIL_SINK file
// tests/e2e's Playwright specs read (server/mail.ts).
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { startTestServer, hasDatabase, skipMessage, type TestServer } from "../helpers/testServer.ts";
import { readMailToken } from "../e2e/helpers/mailSink.ts";

// Read at call time by server/mail.ts, not at module load, but set here
// before startTestServer() below dynamically imports it — same convention
// tests/integration/verifyEmailLimiter.test.ts uses for its own override.
process.env.MURLAN_MAIL_SINK = path.join(mkdtempSync(path.join(tmpdir(), "murlan-mail-")), "sink.jsonl");

describe("register -> mail -> verify-email, end to end", { skip: hasDatabase() ? false : skipMessage() }, () => {
  let server: TestServer;
  before(async () => { server = await startTestServer(); });
  after(async () => { if (server) await server.stop(); });

  test("the code register() actually mails is the one that redeems", async () => {
    const username = "mailroundtrip";
    const email = `${username}@example.test`;
    const registerRes = await fetch(`${server.url}/api/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password: "password123", email }),
    });
    assert.equal(registerRes.status, 202, await registerRes.text());

    const code = await readMailToken(email, "Verify your Murlan email");

    const verifyRes = await fetch(`${server.url}/api/auth/verify-email`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, code }),
    });
    assert.equal(verifyRes.status, 200, await verifyRes.text());
  });
});
