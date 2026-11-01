// tests/integration/sessionPaths.test.ts — which requests pay for the session.
//
// Every request that reads the session costs a `SELECT sess`, and a store that
// touches costs an `UPDATE "session"` on top. Card art, sounds, fonts and the
// bundle are most of a client's requests and never need to know who asked.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import os from "node:os";
import { startTestServer, hasDatabase, skipMessage, type TestServer } from "../helpers/testServer.ts";
import { openSocket, register } from "../helpers/client.ts";
import { pool as appPool } from "../../server/store/db.ts";

const HASHED_BUNDLE = "entry-0123456789abcdef0123456789abcdef.js";
const ASSET = "/assets/images/android-icon-monochrome.png";

const SESSION_SELECT = /select\s+sess\s+from/i;
const SESSION_TOUCH = /update\s+"?(\w+"?\.)?"?session"?\s+set/i;

describe("the session is read where it is used, and never touched", { skip: hasDatabase() ? false : skipMessage() }, () => {
  let server: TestServer;
  let sandbox: string;
  let cookie: string;
  const statements: string[] = [];

  before(async () => {
    sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "murlan-session-"));
    fs.writeFileSync(path.join(sandbox, "index.html"), "<!doctype html><div id=\"root\"></div>");
    fs.writeFileSync(path.join(sandbox, HASHED_BUNDLE), "void 0;");
    process.env.MURLAN_WEB_DIST = sandbox;
    server = await startTestServer();

    const pool = appPool();
    const query = pool.query.bind(pool) as (...args: unknown[]) => unknown;
    (pool as { query: unknown }).query = (...args: unknown[]) => {
      const sql = args[0];
      statements.push(typeof sql === "string" ? sql : ((sql as { text?: string })?.text ?? ""));
      return query(...args);
    };

    ({ cookie } = await register(server, "session_paths"));
    await server.query(`UPDATE "${server.schema}".users SET is_admin = true WHERE username = $1`, ["session_paths"]);
  });

  after(async () => {
    delete process.env.MURLAN_WEB_DIST;
    if (server) await server.stop();
    if (sandbox) fs.rmSync(sandbox, { recursive: true, force: true });
  });

  /** The response read to its end: express-session ends a touching response only once the touch has run. */
  async function counted(pathname: string, withCookie = true) {
    statements.length = 0;
    const res = await fetch(`${server.url}${pathname}`, { headers: withCookie ? { cookie } : {} });
    const body = await res.text();
    return {
      status: res.status,
      body,
      selects: statements.filter((s) => SESSION_SELECT.test(s)).length,
      touches: statements.filter((s) => SESSION_TOUCH.test(s)).length,
    };
  }

  for (const [label, pathname] of [
    ["an /assets file", ASSET],
    ["a hashed bundle", `/${HASHED_BUNDLE}`],
    ["/health", "/health"],
    ["a client-side route the SPA shell answers", "/lobby"],
  ] as const) {
    test(`${label} with a cookie reads no session row and touches none`, async () => {
      const r = await counted(pathname);
      assert.equal(r.status, 200, r.body);
      assert.deepEqual({ selects: r.selects, touches: r.touches }, { selects: 0, touches: 0 });
    });
  }

  test("GET /api/auth/me reads the session once and does not touch it", async () => {
    const r = await counted("/api/auth/me");
    assert.equal(r.status, 200, r.body);
    assert.equal(JSON.parse(r.body).username, "session_paths");
    assert.deepEqual({ selects: r.selects, touches: r.touches }, { selects: 1, touches: 0 });
  });

  test("GET /admin still authenticates by the cookie", async () => {
    assert.equal((await counted("/admin", false)).status, 404);
    const r = await counted("/admin");
    assert.equal(r.status, 200, r.body);
    assert.equal(r.touches, 0);
  });

  test("the socket handshake still accepts the cookie alone", async () => {
    const opened = await openSocket(server, { cookie });
    assert.ok(opened.ok, opened.ok ? "" : opened.err);
    opened.socket.close();
  });
});
