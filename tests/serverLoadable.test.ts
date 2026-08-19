import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
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

// lib/ is mostly client code — react-native, expo-*, AsyncStorage — but a few
// modules are shared with the server, and nothing marks which. Derived rather
// than listed so a seventh is covered the day it is imported: loading one under
// plain Node is what fails if it grows a client-only import, directly or
// through a sibling.
const SERVER_SAFE_LIB = [
  ...new Set(
    ["server", "shared"].flatMap((dir) =>
      readdirSync(path.join(repoRoot, dir))
        .filter((f) => f.endsWith(".ts"))
        .flatMap((f) => [
          ...readFileSync(path.join(repoRoot, dir, f), "utf-8").matchAll(
            /from\s+"[^"]*\/lib\/([a-zA-Z]+)\.ts"/g
          ),
        ])
        .map((m) => m[1])
    )
  ),
].sort();

assert.ok(
  SERVER_SAFE_LIB.length > 0,
  "no lib/ module is imported by server/ or shared/ — the scan found nothing"
);

for (const name of SERVER_SAFE_LIB) {
  test(`lib/${name}.ts is loadable by plain Node — the server imports it`, async () => {
    const mod = await import(`../lib/${name}.ts`);
    assert.ok(mod, `lib/${name}.ts failed to load`);
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
  // pg defaults none of these, so an absent option reads as `undefined`.
  assert.deepEqual(
    {
      max: pool.options.max,
      connectionTimeoutMillis: pool.options.connectionTimeoutMillis,
      idleTimeoutMillis: pool.options.idleTimeoutMillis,
      statement_timeout: pool.options.statement_timeout,
      query_timeout: pool.options.query_timeout,
    },
    {
      max: 10,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      statement_timeout: 5_000,
      query_timeout: 5_000,
    },
    "every bound the pool is meant to carry must be set — an unset one is `undefined`, which waits forever"
  );
});
