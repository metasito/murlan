import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Integration tests boot the real server. That is only possible if every server
// module loads under Node's native type-stripping — no bundler, no path aliases.
// index.ts is excluded: importing it binds a port and installs signal handlers.
const MODULES = readdirSync(path.join(repoRoot, "server"))
  .filter((f) => f.endsWith(".ts") && f !== "index.ts")
  .map((f) => f.slice(0, -3));

assert.ok(MODULES.length > 0, "no server modules found — the derived list is empty");

for (const name of MODULES) {
  test(`server/${name}.ts is loadable by plain Node`, async () => {
    const mod = await import(`../server/${name}.ts`);
    assert.ok(mod, `server/${name}.ts failed to load`);
  });
}

// No database needed: this inspects how the Pool was constructed, not whether
// it can connect.
test("the Postgres pool is constructed with an error handler and timeouts", async () => {
  const { pool } = await import("../server/db.ts");

  assert.equal(
    pool.listenerCount("error"),
    1,
    "the pool must handle its own `error` event — an idle-client error with no listener is an unhandled EventEmitter error"
  );
  assert.notEqual(
    pool.options.connectionTimeoutMillis,
    0,
    "connectionTimeoutMillis of 0 means wait forever for a free client"
  );
  assert.notEqual(
    pool.options.statement_timeout,
    0,
    "statement_timeout of 0 means a stuck query holds its pool slot forever"
  );
});
