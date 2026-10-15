import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel: string) => readFileSync(path.join(repoRoot, rel), "utf8");

const OVERRIDE = "modules/murlan-diagnostics/ios/MurlanRecycledLayout.mm";
const MOUNTING = "node_modules/react-native/React/Fabric/Mounting/ComponentViews";
const COVERED = `${MOUNTING}/View/RCTViewComponentView.mm`;

/** A layout reset other than EmptyLayoutMetrics: a recycled view next laid out at exactly it is never moved (#1485). */
const STALE_RESET = /\b_?layoutMetrics\s*=\s*(?:\{\s*\}|LayoutMetrics\s*\{\s*\}|LayoutMetrics\(\s*\))\s*;/;

function staleResets(source: string): string[] {
  return source.split("\n").filter((line) => STALE_RESET.test(line));
}

test("the override resets a recycled view to EmptyLayoutMetrics after React Native's own prepareForRecycle", () => {
  const source = read(OVERRIDE);
  assert.match(source, /@implementation RCTViewComponentView \(\w+\)/);
  assert.match(source, /class_getInstanceMethod\(self, @selector\(prepareForRecycle\)\)/);
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
