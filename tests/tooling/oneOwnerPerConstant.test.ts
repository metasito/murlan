import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const ciDir = path.join(repoRoot, "tools", "ci");

const definers = (name: string) =>
  readdirSync(ciDir)
    .filter((f) => f.endsWith(".mjs"))
    .filter((f) => new RegExp(`export const ${name}\\b`).test(readFileSync(path.join(ciDir, f), "utf8")));

test("HARD_FACTOR and the e2e port span each have one defining file", () => {
  assert.deepEqual(definers("HARD_FACTOR"), ["e2e-budget.mjs"]);
  assert.deepEqual(definers("PORT_SPAN"), ["e2ePortRange.mjs"]);
  assert.deepEqual(definers("BASE_PORT"), ["e2ePortRange.mjs"]);
});

test("no npm script sets an environment variable inline, which cmd.exe cannot run", () => {
  const { scripts } = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };
  const inline = Object.entries(scripts).filter(([, cmd]) => /^[A-Z_][A-Z0-9_]*=/.test(cmd));
  assert.deepEqual(inline, []);
});
