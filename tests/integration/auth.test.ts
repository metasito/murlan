import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { startTestServer, hasDatabase, skipMessage, type TestServer } from "../helpers/testServer.ts";
import { register, connect as connectRaw } from "../helpers/client.ts";

// One server for the whole file, shared by both describe blocks below.
// server/db.ts's pool is a module-level singleton created on first import;
// stop() ends it, and a second full startTestServer()/stop() cycle in this
// same process would reuse that already-ended pool and fail to boot. Guarded
// by hasDatabase() so a checkout with no DB configured still runs `npm test`
// (see skipMessage()) without this hook itself throwing.
let server: TestServer;
before(async () => { if (hasDatabase()) server = await startTestServer(); });
after(async () => { if (server) await server.stop(); });

describe("socket authentication", { skip: hasDatabase() ? false : skipMessage() }, () => {
  // Local wrapper: this suite only cares about accept/reject, not the raw
  // socket, and always closes on success so sockets never leak across cases.
  async function connect(auth: Record<string, unknown>): Promise<{ ok: boolean; err?: string }> {
    const r = await connectRaw(server, auth);
    r.socket?.close();
    return { ok: r.ok, err: r.err };
  }

  test("a socket with no credentials is rejected", async () => {
    const r = await connect({});
    assert.equal(r.ok, false);
  });

  test("a bare userId is rejected — this was a full impersonation vector", async () => {
    const { user } = await register(server, "victim_a");
    const r = await connect({ userId: user.id });
    assert.equal(r.ok, false, "connecting with only a victim's userId must fail");
  });

  test("a valid ticket is accepted", async () => {
    const { cookie } = await register(server, "holder_a");
    const res = await fetch(`${server.url}/api/auth/socket-ticket`, { method: "POST", headers: { cookie } });
    assert.equal(res.status, 200);
    const { ticket } = await res.json();
    const r = await connect({ ticket });
    assert.equal(r.ok, true, r.err);
  });

  test("a ticket cannot be replayed", async () => {
    const { cookie } = await register(server, "holder_b");
    const res = await fetch(`${server.url}/api/auth/socket-ticket`, { method: "POST", headers: { cookie } });
    const { ticket } = await res.json();
    const first = await connect({ ticket });
    assert.equal(first.ok, true, first.err);
    const second = await connect({ ticket });
    assert.equal(second.ok, false, "a consumed ticket must not authenticate a second socket");
  });

  test("a forged ticket is rejected", async () => {
    const r = await connect({ ticket: "not.a.real.ticket" });
    assert.equal(r.ok, false);
  });
});

describe("session regeneration on login and registration", { skip: hasDatabase() ? false : skipMessage() }, () => {
  // express-session's default cookie name — server/session.ts sets no `name`.
  function sidFromSetCookie(setCookie: string): string {
    const match = /connect\.sid=([^;]+)/.exec(setCookie);
    assert.ok(match, `no connect.sid in set-cookie: ${setCookie}`);
    return match[1];
  }

  test("the session id changes on login", async () => {
    const username = "sid_login";
    const { cookie: cookie1 } = await register(server, username);

    // Send the login on the same cookie register() already produced, the
    // way a returning browser would.
    const res = await fetch(`${server.url}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookie1 },
      body: JSON.stringify({ username, password: "password123" }),
    });
    const text = await res.text();
    assert.equal(res.status, 200, text);
    const cookie2 = res.headers.get("set-cookie");
    assert.ok(cookie2, "login response must set a session cookie");

    assert.notEqual(
      sidFromSetCookie(cookie2),
      sidFromSetCookie(cookie1),
      "login must regenerate the session id, not reuse the one the request carried"
    );
  });

  test("the session id changes on registration", async () => {
    // cookie1 stands in for a session an attacker planted on the victim's
    // browser before the victim ever registers — the scenario SEC-04 closes.
    const { cookie: cookie1 } = await register(server, "sid_reg_attacker");

    const res = await fetch(`${server.url}/api/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookie1 },
      body: JSON.stringify({ username: "sid_reg_victim", password: "password123" }),
    });
    const text = await res.text();
    assert.equal(res.status, 200, text);
    const cookie2 = res.headers.get("set-cookie");
    assert.ok(cookie2, "register response must set a session cookie");

    assert.notEqual(
      sidFromSetCookie(cookie2),
      sidFromSetCookie(cookie1),
      "register must regenerate the session id, not reuse the one the request carried"
    );
  });

  test("a registration whose session step fails leaves no orphaned user", async () => {
    const username = "sid_reg_rollback";
    // The register route creates the user row before it touches the session,
    // so a failing session step must delete that row again — otherwise the
    // username is taken by an account nobody can log into.
    //
    // The failure is driven for real, with no test-only seam in the server: a
    // NOT VALID check constraint on the `session` table that startTestServer()
    // pins this app to makes the store's INSERT fail while leaving deletes
    // alone. Deletes have to keep working — rollbackRegistration reaches
    // storage.deleteUser, which clears the user's own session rows.
    const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL! });
    try {
      await admin.query(
        `ALTER TABLE "${server.schema}".session ADD CONSTRAINT session_writes_fail CHECK (false) NOT VALID`
      );

      const res = await fetch(`${server.url}/api/auth/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password: "password123" }),
      });
      const text = await res.text();
      assert.notEqual(res.status, 200, `registration must fail when the session cannot be saved: ${text}`);
    } finally {
      await admin.query(
        `ALTER TABLE "${server.schema}".session DROP CONSTRAINT session_writes_fail`
      );
      await admin.end();
    }

    // The username being free again is the user-visible proof the rollback
    // ran, and a stronger one than reading the users table.
    const retry = await fetch(`${server.url}/api/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password: "password123" }),
    });
    const retryText = await retry.text();
    assert.equal(retry.status, 200, `the rolled-back username must be free again: ${retryText}`);
  });

  test("logging in twice in the same browser still works", async () => {
    const username = "sid_relogin";
    const { cookie: cookie1 } = await register(server, username);

    const res = await fetch(`${server.url}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookie1 },
      body: JSON.stringify({ username, password: "password123" }),
    });
    const text = await res.text();
    assert.equal(res.status, 200, text);
    const body = JSON.parse(text) as { id: string; username: string };
    assert.equal(body.username, username);
  });
});

describe("username case", { skip: hasDatabase() ? false : skipMessage() }, () => {
  async function login(username: string) {
    return fetch(`${server.url}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password: "password123" }),
    });
  }

  async function registerRaw(username: string) {
    return fetch(`${server.url}/api/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password: "password123" }),
    });
  }

  test("an account registered in one casing logs in under any", async () => {
    const { user } = await register(server, "CaseAlice");
    for (const typed of ["CaseAlice", "casealice", "CASEALICE", "cAsEaLiCe"]) {
      const res = await login(typed);
      const body = await res.text();
      assert.equal(res.status, 200, `${typed}: ${body}`);
      assert.equal(JSON.parse(body).id, user.id);
    }
  });

  test("a differently-cased duplicate is refused", async () => {
    await register(server, "CaseBob");
    const res = await registerRaw("casebob");
    assert.equal(res.status, 409);
    assert.equal((await res.json()).code, "USERNAME_TAKEN");
  });

  // Registration is a read followed by an unserialised write, so two of them
  // can both pass the pre-check. Only the index refuses the second, and it is
  // reached by inserting directly — the route's own check would mask it.
  test("the database refuses a differently-cased duplicate the pre-check let through", async () => {
    const { storage, UsernameTakenError } = await import("../../server/storage.ts");
    await storage.createUser({ username: "CaseCarol", password: "x" });
    await assert.rejects(
      () => storage.createUser({ username: "casecarol", password: "x" }),
      UsernameTakenError
    );

    const { cookie } = await register(server, "CaseSearcher");
    for (const typed of ["CaseCarol", "casecarol", "CASECAROL"]) {
      const res = await fetch(
        `${server.url}/api/users/search?username=${encodeURIComponent(typed)}`,
        { headers: { cookie } }
      );
      const body = await res.text();
      assert.equal(res.status, 200, `${typed}: ${body}`);
      assert.equal(JSON.parse(body).username.toLowerCase(), "casecarol");
    }
  });
});

// #41: the pre-existing authLimiter is per-IP and was login's only defense,
// so one shared home or office NAT shared a single small budget across every
// account behind it. These prove the fix: a per-username limiter that
// actually bounds one account's guesses, without one account's bad luck (or
// an attacker) locking out its neighbors on the same network.
describe("login rate limiting", { skip: hasDatabase() ? false : skipMessage() }, () => {
  async function login(username: string, password: string) {
    return fetch(`${server.url}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
  }

  test("a shared IP does not lock a second account out of login", async () => {
    const attacked = "ratelimit_victim_a";
    await register(server, attacked);
    // MURLAN_LOGIN_USERNAME_RATE_LIMIT is 5 in tests (testServer.ts) — one
    // past it is what used to also spend the single shared authLimiter
    // budget every account on this IP drew from.
    for (let i = 0; i < 6; i++) await login(attacked, "definitely-wrong");

    const bystander = "ratelimit_bystander";
    await register(server, bystander);
    const res = await login(bystander, "password123");
    const body = await res.text();
    assert.equal(res.status, 200, `a second account on the same IP was blocked: ${body}`);
  });

  test("one account still gets limited, even with its own right password", async () => {
    const username = "ratelimit_target";
    await register(server, username);
    for (let i = 0; i < 5; i++) {
      const res = await login(username, "definitely-wrong");
      assert.equal(res.status, 401, `attempt ${i} should still reach the real check`);
    }

    // Over budget now — even the correct password must not get through,
    // because the limiter runs before the credential check, not after it.
    const res = await login(username, "password123");
    const body = await res.text();
    assert.equal(res.status, 401, `a limited account logged in anyway: ${body}`);
    assert.deepEqual(JSON.parse(body), {
      message: "Wrong username or password",
      code: "INVALID_CREDENTIALS",
    });
  });

  test("a limited response does not time like a fast rejection — it pays bcrypt's cost like a real one", async () => {
    const limited = "ratelimit_timing_acct";
    await register(server, limited);
    for (let i = 0; i < 5; i++) await login(limited, "definitely-wrong");

    const SAMPLES = 6;
    const limitedMs: number[] = [];
    const genuineMs: number[] = [];

    for (let i = 0; i < SAMPLES; i++) {
      let t0 = performance.now();
      const limitedRes = await login(limited, "definitely-wrong");
      limitedMs.push(performance.now() - t0);
      assert.equal(limitedRes.status, 401);

      const genuine = `ratelimit_timing_fresh_${i}`;
      await register(server, genuine);
      t0 = performance.now();
      const genuineRes = await login(genuine, "definitely-wrong");
      genuineMs.push(performance.now() - t0);
      assert.equal(genuineRes.status, 401);
    }

    const avg = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
    const limitedAvg = avg(limitedMs);
    const genuineAvg = avg(genuineMs);

    // Not asserting near-equality — CI timing is noisy. What the regression
    // this guards against looks like is a limiter that answers without ever
    // reaching bcrypt: a large, consistent gap, not sampling noise. A loose
    // floor catches that without making the suite flaky.
    assert.ok(
      limitedAvg > genuineAvg * 0.5,
      `limited responses averaged ${limitedAvg.toFixed(1)}ms vs ${genuineAvg.toFixed(1)}ms ` +
        `for a genuine wrong password — the decoy bcrypt.compare may not be running`
    );
  });
});
