// tests/server/testOnlyEnvScan.test.ts — the source scans split out of testOnlyEnv.test.ts so the mutation run keeps that file's behaviour tests
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// Production tuning, not a test seam: these are meant to be set on a deployment.
const PRODUCTION_CONFIG = new Set([
  "MURLAN_PG_POOL_MAX",
  "MURLAN_SOCKET_ADAPTER_POOL_MAX",
]);

function serverEnvReads(): { file: string; name: string }[] {
  const dir = path.join(repoRoot, "server");
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".ts"))
    .flatMap((file) =>
      [...readFileSync(path.join(dir, file), "utf8").matchAll(/process\.env(?:\.|\[")(MURLAN_\w+)/g)]
        .map((m) => ({ file, name: m[1] }))
    );
}

test("every other MURLAN_* the server reads goes through testOnlyEnv", () => {
  const bare = serverEnvReads()
    .filter(({ name }) => !PRODUCTION_CONFIG.has(name))
    .map(({ file, name }) => `${file}: ${name}`);
  assert.deepEqual(bare, []);
});

test("every production-config exemption is still read by the server", () => {
  const read = new Set(serverEnvReads().map(({ name }) => name));
  assert.deepEqual([...PRODUCTION_CONFIG].filter((name) => !read.has(name)), []);
});
