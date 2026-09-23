// tests/tooling/metroCacheVersion.test.ts — Metro's machine-wide transform cache is keyed on the
// checkout and on the inlined EXPO_PUBLIC_* values (docs/agents/checks.md, "Remaining traps").
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const configPath = path.join(repoRoot, "metro.config.js");
const require = createRequire(configPath);

function cacheVersionWith(env: Record<string, string>): string {
  const saved = { ...process.env };
  Object.assign(process.env, env);
  delete require.cache[configPath];
  try {
    return require(configPath).cacheVersion;
  } finally {
    for (const key of Object.keys(env)) {
      if (key in saved) process.env[key] = saved[key];
      else delete process.env[key];
    }
    delete require.cache[configPath];
  }
}

test("the cache key names this checkout", () => {
  assert.ok(cacheVersionWith({}).includes(repoRoot), `cacheVersion does not name ${repoRoot}`);
});

test("the cache key changes with an inlined EXPO_PUBLIC_* value", () => {
  const a = cacheVersionWith({ EXPO_PUBLIC_CACHE_KEY_PROBE: "a" });
  const b = cacheVersionWith({ EXPO_PUBLIC_CACHE_KEY_PROBE: "b" });
  assert.notEqual(a, b);
});
