// tests/integration/rename.test.ts — `PATCH /api/users/me` renames the signed-in
// account.
//
// `username` is unique twice over (shared/schema.ts): the column's own
// constraint, and `users_username_lower_uq` on `lower(username)`. So a
// collision is case-insensitive, and it has to arrive as an expected 409
// rather than as a 500 from a constraint violation.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { startTestServer, hasDatabase, skipMessage, type TestServer } from "../helpers/testServer.ts";
import { register } from "../helpers/client.ts";

// Lowered so the cap is reachable in a test without renaming a hundred times.
// Read at module scope by server/routes.ts, so it must be set before the app is
// imported — the same contract tests/helpers/testServer.ts documents.
const RENAME_LIMIT = 3;
process.env.MURLAN_RENAME_RATE_LIMIT = String(RENAME_LIMIT);

describe("renaming an account", { skip: hasDatabase() ? false : skipMessage() }, () => {
  let server: TestServer;

  before(async () => {
    server = await startTestServer();
  });
  after(async () => {
    await server?.stop();
  });

  const rename = (cookie: string, username: string) =>
    fetch(`${server.url}/api/users/me`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ username }),
    });

  const nameOf = async (cookie: string) => {
    const res = await fetch(`${server.url}/api/auth/me`, { headers: { cookie } });
    return ((await res.json()) as { username: string }).username;
  };

  test("the new name is what every later read projects", async () => {
    const { cookie } = await register(server, "ren_before");
    const res = await rename(cookie, "ren_after");
    assert.equal(res.status, 200, await res.text());
    assert.equal(await nameOf(cookie), "ren_after");
  });

  test("a name taken by someone else fails with a reason, not a constraint error", async () => {
    await register(server, "ren_squatter");
    const { cookie } = await register(server, "ren_hopeful");
    const res = await rename(cookie, "ren_squatter");
    assert.equal(res.status, 409);
    assert.equal(((await res.json()) as { code: string }).code, "USERNAME_TAKEN");
    assert.equal(await nameOf(cookie), "ren_hopeful");
  });

  // The second unique index is on `lower(username)`, so this collides in the
  // database even though the two strings differ. Reporting it as anything but
  // a normal 409 means a 500 for a case a player will hit by accident.
  test("a name differing only in case is taken too", async () => {
    await register(server, "ren_Owner");
    const { cookie } = await register(server, "ren_other");
    const res = await rename(cookie, "REN_OWNER");
    assert.equal(res.status, 409);
    assert.equal(((await res.json()) as { code: string }).code, "USERNAME_TAKEN");
  });

  // Recasing your own name collides with your own row on that same index, so
  // the collision check has to compare ids rather than just look the name up.
  test("recasing your own name is allowed", async () => {
    const { cookie } = await register(server, "ren_case");
    const res = await rename(cookie, "REN_Case");
    assert.equal(res.status, 200, await res.text());
    assert.equal(await nameOf(cookie), "REN_Case");
  });

  test("the rules are registration's, not a second copy", async () => {
    const { cookie } = await register(server, "ren_rules");
    for (const bad of ["ab", "has spaces", "!!!", "x".repeat(31)]) {
      const res = await rename(cookie, bad);
      assert.equal(res.status, 400, `${bad} should have been refused: ${await res.text()}`);
    }
    assert.equal(await nameOf(cookie), "ren_rules");
  });

  // A rename with no ceiling is how one account cycles through names to
  // impersonate others between games. The budget is the account's, not the
  // address's — a household NAT would otherwise share one.
  test("an account cannot cycle through names without limit", async () => {
    const { cookie } = await register(server, "ren_cycler");
    const seen = new Set<number>();
    for (let i = 0; i < RENAME_LIMIT + 1; i++) seen.add((await rename(cookie, `ren_cy_${i}`)).status);
    assert.ok(seen.has(429), `never hit the cap in ${RENAME_LIMIT + 1} renames: saw ${[...seen]}`);
  });

  test("a signed-out request cannot rename anyone", async () => {
    const res = await fetch(`${server.url}/api/users/me`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "ren_nobody" }),
    });
    assert.equal(res.status, 401);
  });
});
