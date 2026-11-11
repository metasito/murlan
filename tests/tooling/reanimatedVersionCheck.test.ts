// metro.config.js resolves Reanimated's worklets-version check to an empty module in a production
// bundle, which holds only while every caller of the check runs it under `__DEV__` alone.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const require = createRequire(import.meta.url);
const reanimated = path.dirname(require.resolve("react-native-reanimated/package.json"));
const CHECK = path.join(reanimated, "scripts", "validate-worklets-version.js");
const MODULE = path.join(reanimated, "lib", "module");

const CALL = /\bassertWorkletsVersion\(\)/g;
const GATED = /if \(__DEV__\) \{[^{}]*\bassertWorkletsVersion\(\);[^{}]*\}/g;

function moduleSources(dir: string): [string, string][] {
  return fs.readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && e.name.endsWith(".js"))
    .map((e) => {
      const file = path.join(e.parentPath, e.name);
      return [path.relative(dir, file), fs.readFileSync(file, "utf8")];
    });
}

test("the gate pattern sees what it is for", () => {
  assert.equal("if (__DEV__) {\n  a();\n  assertWorkletsVersion();\n}".match(GATED)?.length, 1);
  assert.equal("assertWorkletsVersion();".match(GATED), null);
  assert.equal("if (__DEV__) { x(); }\nassertWorkletsVersion();".match(GATED), null);
});

test("Reanimated calls its worklets-version check under `__DEV__` alone", () => {
  const callers = moduleSources(MODULE).filter(([, src]) => src.includes("assertWorkletsVersion()") && !src.includes("export function assertWorkletsVersion"));
  assert.ok(callers.length >= 2, `found ${callers.length} callers of the check, expected Reanimated's two`);
  for (const [file, src] of callers) {
    const calls = src.match(CALL)?.length ?? 0;
    assert.equal(src.match(GATED)?.length ?? 0, calls, `${file} calls the check outside \`if (__DEV__)\``);
  }
});

test("Metro empties the check in a production bundle, and only there", () => {
  const { resolver } = require(path.join(repoRoot, "metro.config.js"));
  const at = (filePath: string, dev: boolean) =>
    resolver.resolveRequest({ dev, resolveRequest: () => ({ type: "sourceFile", filePath }) }, "x", "web");
  assert.ok(fs.existsSync(CHECK), `no check at ${CHECK}`);
  assert.deepEqual(at(CHECK, false), { type: "empty" });
  assert.deepEqual(at(CHECK, true), { type: "sourceFile", filePath: CHECK });
  const other = path.join(reanimated, "scripts", "other.js");
  assert.deepEqual(at(other, false), { type: "sourceFile", filePath: other });
});
