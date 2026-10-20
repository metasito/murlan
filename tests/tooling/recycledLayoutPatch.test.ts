import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel: string) => readFileSync(path.join(repoRoot, rel), "utf8");

const OVERRIDE = "modules/murlan-diagnostics/ios/MurlanRecycledLayout.mm";
// Resolved, never `node_modules/` under repoRoot: a worktree has no install of its own (RULES.md rule 9).
const reactNative = path.dirname(createRequire(import.meta.url).resolve("react-native/package.json"));
const MOUNTING = path.relative(repoRoot, path.join(reactNative, "React/Fabric/Mounting/ComponentViews")).replaceAll("\\", "/");
const COVERED = `${MOUNTING}/View/RCTViewComponentView.mm`;

/** A layout reset other than EmptyLayoutMetrics: a recycled view next laid out at exactly it is never moved (#1485). */
const STALE_RESET = /\b_?layoutMetrics\s*=\s*(?:\{\s*\}|LayoutMetrics\s*\{\s*\}|LayoutMetrics\(\s*\))\s*;/;

function staleResets(source: string): string[] {
  return source.split("\n").filter((line) => STALE_RESET.test(line));
}

const DROP = `react-native contains react/react-native#57590: delete ${OVERRIDE} and this test`;

/** The covered file still resets stale, or the override fixes nothing. */
function assertStillStale(file: string): void {
  assert.ok(staleResets(readFileSync(file, "utf8")).length > 0, DROP);
}

test("the override resets a recycled view to EmptyLayoutMetrics after React Native's own prepareForRecycle", () => {
  const source = read(OVERRIDE);
  assert.match(source, /@implementation RCTViewComponentView \(\w+\)/);
  assert.match(source, /Method method = class_getInstanceMethod\(self, @selector\(prepareForRecycle\)\);\s*NSCAssert\(method, @"[^"]+"\);/);
  assert.match(source, /original\(view, @selector\(prepareForRecycle\)\);\s*\[view \w+\];/);
  assert.match(source, /_layoutMetrics = EmptyLayoutMetrics;/);
  assert.match(read("modules/murlan-diagnostics/ios/MurlanDiagnostics.podspec"), /source_files = '\*\.\{[^}]*\bmm\b[^}]*\}'/);
});

test("no installed component view the override does not cover resets its layout stale", () => {
  const walk = (dir: string): string[] =>
    readdirSync(path.join(repoRoot, dir), { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(`${dir}/${e.name}`) : /\.mm?$/.test(e.name) ? [`${dir}/${e.name}`] : []
    );
  const files = walk(MOUNTING);
  assert.ok(files.includes(COVERED), "the scan no longer reaches RCTViewComponentView.mm");
  assert.deepEqual(files.filter((f) => f !== COVERED && staleResets(read(f)).length > 0), []);
});

test("every spelling of a stale reset is caught, and the empty sentinel is not", () => {
  for (const line of ["  _layoutMetrics = {};", "  _layoutMetrics = { };", "  _layoutMetrics = LayoutMetrics{};", "  layoutMetrics = LayoutMetrics();"]) {
    assert.deepEqual(staleResets(line), [line]);
  }
  assert.deepEqual(staleResets("  _layoutMetrics = EmptyLayoutMetrics;"), []);
  assert.deepEqual(staleResets("  _layoutMetrics = layoutMetrics;"), []);
});

test("the file the override covers still resets its layout stale", () => {
  assertStillStale(path.join(repoRoot, COVERED));
});

test("a covered file with no stale reset left is named for dropping the override", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "recycled-layout-"));
  try {
    const fixed = path.join(dir, "RCTViewComponentView.mm");
    writeFileSync(fixed, "- (void)prepareForRecycle\n{\n  _layoutMetrics = EmptyLayoutMetrics;\n}\n");
    assert.throws(() => assertStillStale(fixed), { message: DROP });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
