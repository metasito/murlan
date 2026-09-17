// tests/integrationPorts.test.ts — two integration files spawning a server on one port
// fail each other whenever node --test runs them together.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

test("every fixed port a test spawns a server on belongs to one file", () => {
  const owners = new Map<number, string[]>();
  for (const file of readdirSync("tests/integration").filter((f) => f.endsWith(".ts"))) {
    const source = readFileSync(`tests/integration/${file}`, "utf8");
    for (const decl of source.matchAll(/const \w*PORTS?\s*=\s*([^;]+);/g)) {
      for (const port of decl[1].match(/\b\d{4,5}\b/g) ?? []) {
        owners.set(Number(port), [...(owners.get(Number(port)) ?? []), file]);
      }
    }
  }
  assert.ok(owners.size >= 3, `found only ${owners.size} ports — the scan no longer reads the declarations`);
  const shared = [...owners].filter(([, files]) => files.length > 1);
  assert.deepEqual(shared, []);
});
