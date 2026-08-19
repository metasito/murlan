// tests/integration/passwordReset.test.ts — the owner-run password reset.
//
// There is no self-serve recovery, so this script is the only way a locked-out
// account gets back in. It writes a bcrypt hash directly, which means the login
// route has to accept it — asserted here against the real server rather than by
// reading both sides and hoping they agree.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  startTestServer,
  hasDatabase,
  skipMessage,
  type TestServer,
} from "../helpers/testServer.ts";
import { register } from "../helpers/client.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const script = path.join(repoRoot, "scripts", "reset-password.mjs");

describe("owner password reset", { skip: hasDatabase() ? false : skipMessage() }, () => {
  let server: TestServer;
  before(async () => { server = await startTestServer(); });
  after(async () => { if (server) await server.stop(); });

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
