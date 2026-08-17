import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * A boot that cannot reach Postgres must fail loudly. `ensureSchema` refuses
 * to serve requests against a schema it could not verify, and that refusal is
 * only worth anything if it reaches the caller — a process guard installed
 * during construction would turn it into a logged line, no listening socket,
 * and exit 0.
 *
 * This file must own its process: it points DATABASE_URL at a port nothing
 * listens on and asserts on the process's own listener set. `node --test` runs
 * each test file in its own child process, which is what makes that safe.
 *
 * The boot runs here at module scope rather than inside the test because the
 * test runner installs an `unhandledRejection` listener of its own the moment
 * it starts running tests, and the assertion below is that the count is zero.
 */

// Before any server module is imported: server/db.ts builds its Pool from
// DATABASE_URL at module scope, and server/session.ts reads SESSION_SECRET.
process.env.DATABASE_URL = "postgres://postgres:postgres@127.0.0.1:1/murlan_unreachable";
process.env.SESSION_SECRET = "boot-failure-test";

const { createApp } = await import("../server/testApp.ts");
const bootOutcome: unknown = await createApp().then(
  () => "resolved",
  (err: unknown) => err
);
const guardsWhenBootFailed = process.listenerCount("unhandledRejection");

test("createApp() rejects when the database is unreachable, and nothing swallows it", () => {
  assert.ok(
    bootOutcome instanceof Error,
    "createApp() must reject rather than resolve against an unusable database"
  );
  assert.equal(
    guardsWhenBootFailed,
    0,
    "no process guard may be installed while createApp() can still fail — it would contain the failure and let the process exit 0"
  );
});
