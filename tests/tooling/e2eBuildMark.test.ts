import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { assertMark, DIAGNOSTICS_MARK, E2E_BUILD_MARK } from "../../scripts/e2eBuildMark.mjs";
import { blankCommentsAndStrings, sourcesUnder } from "../helpers/sourceScan.ts";
import { loadAction, loadWorkflow, step } from "../helpers/workflow.ts";

const root = path.resolve(import.meta.dirname, "..", "..");
const markSource = readFileSync(path.join(root, "lib", "e2eConfig.ts"), "utf8");

test("the mark is set when any flag the app reads is on", () => {
  const read = new Set<string>();
  for (const [rel, src] of sourcesUnder(root, ["app", "components", "context", "lib"])) {
    if (rel.endsWith("e2eConfig.ts")) continue;
    for (const m of blankCommentsAndStrings(src).matchAll(/process\.env\.(EXPO_PUBLIC_E2E_\w+)/g)) read.add(m[1]);
  }
  assert.ok(read.size > 0, "no EXPO_PUBLIC_E2E_* read found — the scan is looking in the wrong place");
  for (const flag of read) assert.match(markSource, new RegExp(`process\\.env\\.${flag} === '1'`), flag);
  assert.ok(markSource.includes(`'${E2E_BUILD_MARK}'`));
});

test("the root layout loads the mark", () => {
  const layout = readFileSync(path.join(root, "app", "_layout.tsx"), "utf8");
  assert.match(layout, /^import "@\/lib\/e2eConfig";$/m);
});

test("every workflow or action that builds with a test-only flag checks the build carries it", () => {
  const files = [
    ...readdirSync(path.join(root, ".github", "workflows")).map((f) => path.join(".github", "workflows", f)),
    ...readdirSync(path.join(root, ".github", "actions")).map((a) => path.join(".github", "actions", a, "action.yml")),
  ];
  const flagged = files.filter((f) => /EXPO_PUBLIC_E2E_\w+\s*[:=]\s*"1"/.test(readFileSync(path.join(root, f), "utf8")));
  assert.ok(flagged.includes(path.join(".github", "actions", "ios-app", "action.yml")), "the scan no longer sees the iOS build's flag");
  for (const f of flagged) assert.match(readFileSync(path.join(root, f), "utf8"), /e2eBuildMark\.mjs [^\n]*--present/, f);
});

test("every store build ci.yml compiles proves it carries no test-only flag", () => {
  const ci = readFileSync(path.join(root, ".github", "workflows", "ci.yml"), "utf8");
  for (const built of ["dist", '"$RUNNER_TEMP/apk"']) {
    assert.match(ci, new RegExp(`e2eBuildMark\\.mjs --absent ${built.replace(/\$/g, "\\$")}\\n`), built);
  }
  const ios = loadWorkflow("ci.yml").jobs["ios-build"].steps!.filter((s) => s.uses === "./.github/actions/ios-app");
  assert.deepEqual(ios.map((s) => [s.with?.flavour, s.with?.configuration]), [[undefined, undefined]], "ci.yml compiles the player's Release build");
  const action = loadAction("ios-app");
  assert.equal((action.inputs?.flavour as { default?: string }).default, "player");
  assert.equal((action.inputs?.configuration as { default?: string }).default, "Release");
  const marks = step(action, "The app carries its flavour's marks, and no other's");
  assert.equal(marks.if, "inputs.mode != 'fill' && inputs.configuration == 'Release'");
  assert.match(marks.run ?? "", /echo --present \|\| echo --absent\)" "\$APP"\n/);
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

test("the diagnostics mark is judged like the e2e one", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "murlan-diag-"));
  writeFileSync(path.join(dir, "a.js"), `x="${DIAGNOSTICS_MARK}"`);
  assert.throws(() => assertMark("--absent", [dir], DIAGNOSTICS_MARK), /a\.js/);
  assert.doesNotThrow(() => assertMark("--present", [dir], DIAGNOSTICS_MARK));
  assert.doesNotThrow(() => assertMark("--absent", [dir]));
});
