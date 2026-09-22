import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { assertMark, E2E_BUILD_MARK } from "../../scripts/e2eBuildMark.mjs";

const root = path.resolve(import.meta.dirname, "..", "..");
const markSource = readFileSync(path.join(root, "lib", "e2eBuildMark.ts"), "utf8");

test("the mark is set when any flag the app reads is on", () => {
  const read = new Set<string>();
  for (const dir of ["app", "components", "context", "lib"]) {
    for (const f of readdirSync(path.join(root, dir), { recursive: true, encoding: "utf8" })) {
      if (!/\.tsx?$/.test(f) || f.endsWith("e2eBuildMark.ts")) continue;
      const src = readFileSync(path.join(root, dir, f), "utf8");
      for (const m of src.matchAll(/process\.env\.(EXPO_PUBLIC_E2E_\w+)/g)) read.add(m[1]);
    }
  }
  assert.ok(read.size > 0, "no EXPO_PUBLIC_E2E_* read found — the scan is looking in the wrong place");
  for (const flag of read) assert.match(markSource, new RegExp(`process\\.env\\.${flag} === '1'`), flag);
  assert.ok(markSource.includes(`'${E2E_BUILD_MARK}'`));
});

test("the root layout loads the mark", () => {
  const layout = readFileSync(path.join(root, "app", "_layout.tsx"), "utf8");
  assert.match(layout, /^import "@\/lib\/e2eBuildMark";$/m);
});

test("every workflow that builds with a test-only flag checks the build carries it", () => {
  const dir = path.join(root, ".github", "workflows");
  const flagged = readdirSync(dir).filter((f) => /EXPO_PUBLIC_E2E_\w+: "1"/.test(readFileSync(path.join(dir, f), "utf8")));
  assert.ok(flagged.includes("ios.yml"), "the scan no longer sees ios.yml's flag");
  for (const f of flagged) assert.match(readFileSync(path.join(dir, f), "utf8"), /e2eBuildMark\.mjs --present /, f);
});

test("a build directory is judged by whether any file carries the mark", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "murlan-mark-"));
  mkdirSync(path.join(dir, "js"));
  writeFileSync(path.join(dir, "js", "clean.js"), "var a=1;");
  assert.doesNotThrow(() => assertMark("--absent", [dir]));
  assert.throws(() => assertMark("--present", [dir]), /carries no/);
  writeFileSync(path.join(dir, "js", "flagged.js"), `globalThis.murlanE2EBuild="${E2E_BUILD_MARK}"`);
  assert.throws(() => assertMark("--absent", [dir]), /flagged\.js/);
  assert.doesNotThrow(() => assertMark("--present", [dir]));
  assert.throws(() => assertMark("--absent", [path.join(dir, "missing")]), /does not exist/);
});
