// tests/integration/passwordReset.test.ts — both password-reset paths.
//
// "owner password reset" below is the break-glass script
// (scripts/reset-password.mjs): the only recovery for an account with no
// verified email yet, or that has lost access to its mailbox. It writes a
// bcrypt hash directly, which means the login route has to accept it —
// asserted here against the real server rather than by reading both sides
// and hoping they agree.
//
// "password reset" is the self-serve "forgot password" flow added by #862:
// request + submit endpoints. A reset token is a credential: single-use,
// expiring, never handed back through the enumeration-safe request
// endpoint's response, and its redemption evicts every session and sibling
// token for the account — the same live-credential class Boxes 2 and 6 of
// docs/superpowers/specs/2026-09-03-account-recovery-design.md both name.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startTestServer, hasDatabase, skipMessage, type TestServer } from "../helpers/testServer.ts";
import { register } from "../helpers/client.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const script = path.join(repoRoot, "scripts", "reset-password.mjs");

// One server for the whole file, shared by both describe blocks below —
// server/db.ts's pool is a module-level singleton created on first import;
// stop() ends it, and a second full startTestServer()/stop() cycle in this
// same process would reuse that already-ended pool and fail to boot (see
// tests/integration/auth.test.ts, which does the same for the same reason).
let server: TestServer;
before(async () => { if (hasDatabase()) server = await startTestServer(); });
after(async () => { if (server) await server.stop(); });

describe("owner password reset", { skip: hasDatabase() ? false : skipMessage() }, () => {
  const login = (username: string, password: string) =>
    fetch(`${server.url}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password }),
    });

  test("a reset password logs in, and the old one stops working", async () => {
    await register(server, "LockedOut");

    const out = execFileSync("node", [script, "LockedOut"], {
      encoding: "utf8",
      env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL, ALLOW_RESET: "1" },
    });
    const match = out.match(/temporary password: (\S+)/);
    assert.ok(match, `the script printed no password:\n${out}`);
    const temporary = match[1];

    const withNew = await login("LockedOut", temporary);
    assert.equal(withNew.status, 200, await withNew.text());

    const withOld = await login("LockedOut", "password123");
    assert.equal(withOld.status, 401);
  });

  test("the username is matched case-insensitively, like login", async () => {
    await register(server, "CaseLocked");
    const out = execFileSync("node", [script, "caselocked"], {
      encoding: "utf8",
      env: { ...process.env, ALLOW_RESET: "1" },
    });
    const temporary = out.match(/temporary password: (\S+)/)![1];
    const res = await login("CaseLocked", temporary);
    assert.equal(res.status, 200, await res.text());
  });

  test("an unknown username is refused, and changes nothing", () => {
    assert.throws(
      () =>
        execFileSync("node", [script, "NoSuchPerson"], {
          encoding: "utf8",
          env: { ...process.env, ALLOW_RESET: "1" },
          stdio: "pipe",
        }),
      /no account named/i
    );
  });

  test("it refuses to run without the opt-in", () => {
    assert.throws(
      () =>
        execFileSync("node", [script, "LockedOut"], {
          encoding: "utf8",
          env: { ...process.env, ALLOW_RESET: undefined },
          stdio: "pipe",
        }),
      /ALLOW_RESET/
    );
  });
});

describe("password reset", { skip: hasDatabase() ? false : skipMessage() }, () => {
  function requestReset(email: string) {
    return fetch(`${server.url}/api/auth/request-password-reset`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    });
  }

  function submitReset(token: string, newPassword: string) {
    return fetch(`${server.url}/api/auth/reset-password`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, newPassword }),
    });
  }

  function login(username: string, password: string) {
    return fetch(`${server.url}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
  }

  function me(cookie: string) {
    return fetch(`${server.url}/api/auth/me`, { headers: { cookie } });
  }

  /** Registers, then verifies the way the email-verify flow itself would. */
  async function verifiedUser(username: string) {
    const { user, cookie } = await register(server, username);
    const { storage } = await import("../../server/storage.ts");
    await storage.markEmailVerified(user.id);
    return { user, cookie, email: `${username.toLowerCase()}@example.test` };
  }

  test("an unverified account's reset request mints no token and answers like any other", async () => {
    const { user } = await register(server, "reset_unverified");
    const res = await requestReset("reset_unverified@example.test");
    const text = await res.text();
    assert.equal(res.status, 200, text);
    assert.deepEqual(JSON.parse(text), { ok: true });

    const { db } = await import("../../server/db.ts");
    const { authTokens } = await import("../../shared/schema.ts");
    const { eq, and } = await import("drizzle-orm");
    const rows = await db
      .select()
      .from(authTokens)
      .where(and(eq(authTokens.userId, user.id), eq(authTokens.purpose, "password_reset")));
    assert.equal(rows.length, 0, "an unverified account must never get a password_reset token minted");
  });

  test("a nonexistent address gets the identical 200 { ok: true }", async () => {
    const res = await requestReset("nobody_reset_at_all@example.test");
    const text = await res.text();
    assert.equal(res.status, 200, text);
    assert.deepEqual(JSON.parse(text), { ok: true });
  });

  test("a verified account's reset request mints exactly one password_reset token", async () => {
    const { user, email } = await verifiedUser("reset_mints_one");
    const res = await requestReset(email);
    assert.equal(res.status, 200, await res.text());

    const { db } = await import("../../server/db.ts");
    const { authTokens } = await import("../../shared/schema.ts");
    const { eq, and } = await import("drizzle-orm");
    const readRows = () =>
      db
        .select()
        .from(authTokens)
        .where(and(eq(authTokens.userId, user.id), eq(authTokens.purpose, "password_reset")));

    // The route replies before minting (design doc, Box 5) precisely so the
    // mint can never be timed from the response — which means this row is
    // not guaranteed to exist the instant the 200 lands, only shortly after.
    let rows = await readRows();
    for (let attempt = 0; attempt < 20 && rows.length === 0; attempt++) {
      await new Promise((r) => setTimeout(r, 50));
      rows = await readRows();
    }
    assert.equal(rows.length, 1, "a verified request must mint exactly one password_reset token");
    assert.equal(rows[0]!.usedAt, null);
  });

  // A smoke test, not the guarantee — timing is noise-bound on CI, so the
  // deterministic one is tests/authReplyBeforeMail.test.ts's AST check that
  // the reply's own source position precedes the mint and the send (#897).
  // What this still catches is the same regression class in a way an AST
  // scan cannot: the mail send itself leaking into the response path, which
  // is a network round trip of hundreds of ms, not noise. Both branches now
  // do the identical one indexed `users` lookup before replying (b), so
  // there is no longer a real extra insert to budget for either.
  test("the request endpoint replies without awaiting the mail send, and timing is comparable for a real vs. nonexistent address", async () => {
    const SAMPLES = 15;
    const realMs: number[] = [];
    const fakeMs: number[] = [];

    for (let i = 0; i < SAMPLES; i++) {
      const { email } = await verifiedUser(`reset_timing_real_${i}`);
      let t0 = performance.now();
      const realRes = await requestReset(email);
      realMs.push(performance.now() - t0);
      assert.equal(realRes.status, 200);

      t0 = performance.now();
      const fakeRes = await requestReset(`reset_timing_fake_${i}@example.test`);
      fakeMs.push(performance.now() - t0);
      assert.equal(fakeRes.status, 200);
    }

    const median = (values: number[]) => {
      const sorted = [...values].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
    };
    const realMedian = median(realMs);
    const fakeMedian = median(fakeMs);

    assert.ok(
      realMedian < fakeMedian * 1.5 + 20,
      `a real address had a median of ${realMedian.toFixed(1)}ms vs ${fakeMedian.toFixed(1)}ms for a ` +
        `nonexistent one — the response may be awaiting the mail send`
    );
  });

  test("a used token cannot be redeemed twice", async () => {
    const { user } = await verifiedUser("reset_used_twice");
    const { mintAuthToken, redeemAuthToken } = await import("../../server/authTokens.ts");
    const token = await mintAuthToken(user.id, "password_reset", 60_000);

    const first = await submitReset(token, "brand-new-pw-1");
    assert.equal(first.status, 200, await first.text());

    const withNew = await login(user.username, "brand-new-pw-1");
    assert.equal(withNew.status, 200, await withNew.text());

    const second = await submitReset(token, "another-pw-2");
    const secondText = await second.text();
    assert.equal(second.status, 400, secondText);
    assert.equal(JSON.parse(secondText).code, "INVALID_RESET_TOKEN");

    // Same guard the route uses, exercised directly.
    const direct = await redeemAuthToken(token, "password_reset");
    assert.equal(direct, null, "redeemAuthToken must refuse an already-used password_reset token");

    // The rejected second attempt did not overwrite the first password.
    const stillNew = await login(user.username, "brand-new-pw-1");
    assert.equal(stillNew.status, 200);
  });

  test("an expired token fails to redeem and changes nothing", async () => {
    const { user } = await verifiedUser("reset_expired");
    const { mintAuthToken, redeemAuthToken } = await import("../../server/authTokens.ts");
    // A full minute in the past, not -1ms: under a loaded machine the redeem
    // query's `now()` runs in Postgres, not Node, and a margin of a
    // millisecond is inside plausible clock skew between the two processes.
    const token = await mintAuthToken(user.id, "password_reset", -60_000);

    const res = await submitReset(token, "should-not-apply-1");
    const text = await res.text();
    assert.equal(res.status, 400, text);
    assert.equal(JSON.parse(text).code, "INVALID_RESET_TOKEN");

    const direct = await redeemAuthToken(token, "password_reset");
    assert.equal(direct, null, "an expired token must not redeem via the module either");

    const stillOld = await login(user.username, "password123");
    assert.equal(stillOld.status, 200, "an expired-token attempt must not have changed the password");
  });

  test("an unknown token is rejected with the same generic error", async () => {
    const res = await submitReset("not-a-real-token-at-all", "whatever-pw-1");
    const text = await res.text();
    assert.equal(res.status, 400, text);
    assert.equal(JSON.parse(text).code, "INVALID_RESET_TOKEN");
  });

  test("a successful reset clears every session for that user, but not another user's", async () => {
    const { user, cookie: deviceA } = await verifiedUser("reset_clears_sessions");
    const loginRes = await login("reset_clears_sessions", "password123");
    const deviceB = loginRes.headers.get("set-cookie");
    assert.ok(deviceB, "second login must set its own session cookie");

    const bystander = await verifiedUser("reset_bystander");

    const { mintAuthToken } = await import("../../server/authTokens.ts");
    const token = await mintAuthToken(user.id, "password_reset", 60_000);
    const res = await submitReset(token, "post-reset-pw-1");
    assert.equal(res.status, 200, await res.text());

    assert.equal((await me(deviceA)).status, 401, "a session predating the reset must be cleared");
    assert.equal((await me(deviceB!)).status, 401, "every session for the account must be cleared");
    assert.equal((await me(bystander.cookie)).status, 200, "a different account's session must survive");
  });

  test("a completed reset makes a second outstanding token for that user unredeemable", async () => {
    const { user } = await verifiedUser("reset_sibling_invalidated");
    const { mintAuthToken, redeemAuthToken } = await import("../../server/authTokens.ts");
    const first = await mintAuthToken(user.id, "password_reset", 60_000);
    const second = await mintAuthToken(user.id, "password_reset", 60_000);

    const res = await submitReset(first, "sibling-test-pw-1");
    assert.equal(res.status, 200, await res.text());

    const direct = await redeemAuthToken(second, "password_reset");
    assert.equal(direct, null, "an outstanding sibling token must be invalidated by a completed reset");
  });

  test("a shared IP hammering one address does not lock a different address out of its own reset request", async () => {
    const target = "reset_ratelimit_target@example.test";
    // MURLAN_PASSWORD_RESET_REQUEST_RATE_LIMIT is 5 in tests (testServer.ts).
    for (let i = 0; i < 5; i++) {
      const res = await requestReset(target);
      assert.equal(res.status, 200, `attempt ${i} against the targeted address should still succeed`);
    }
    const limited = await requestReset(target);
    assert.equal(limited.status, 429, "the sixth request against the same address must trip its own limiter");

    const { email } = await verifiedUser("reset_ratelimit_bystander");
    const bystander = await requestReset(email);
    const text = await bystander.text();
    assert.equal(bystander.status, 200, `a different address on the same IP was blocked: ${text}`);
  });
});
