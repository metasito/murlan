import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel: string) => readFileSync(path.join(repoRoot, rel), "utf8");

const locked: string = JSON.parse(read("package-lock.json")).packages["node_modules/react-native"].version;
const PATCH = `patches/react-native+${locked}.patch`;
const MOUNTING = "node_modules/react-native/React/Fabric/Mounting/ComponentViews";

/** A layout reset other than EmptyLayoutMetrics: a recycled view next laid out at exactly it is never moved (#1485). */
const STALE_RESET = /\b_?layoutMetrics\s*=\s*(?:\{\s*\}|LayoutMetrics\s*\{\s*\}|LayoutMetrics\(\s*\))\s*;/;

function staleResets(source: string): string[] {
  return source.split("\n").filter((line) => STALE_RESET.test(line));
}

test("the React Native patch is named for the locked version and resets a recycled view to EmptyLayoutMetrics", () => {
  assert.ok(existsSync(path.join(repoRoot, PATCH)), `${PATCH} is missing; re-derive it for React Native ${locked}`);
  const patch = read(PATCH);
  assert.match(patch, /^-\s+_layoutMetrics = \{\};$/m);
  assert.match(patch, /^\+\s+_layoutMetrics = EmptyLayoutMetrics;$/m);
});

test("no installed component view resets its layout to anything but EmptyLayoutMetrics", () => {
  const walk = (dir: string): string[] =>
    readdirSync(path.join(repoRoot, dir), { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(`${dir}/${e.name}`) : /\.mm?$/.test(e.name) ? [`${dir}/${e.name}`] : []
    );
  const files = walk(MOUNTING);
  assert.ok(files.some((f) => f.endsWith("/View/RCTViewComponentView.mm")), "the scan no longer reaches RCTViewComponentView.mm");
  assert.ok(read(`${MOUNTING}/View/RCTViewComponentView.mm`).includes("_layoutMetrics = EmptyLayoutMetrics;"), "the patch is not applied: run npm install");
  assert.deepEqual(files.filter((f) => staleResets(read(f)).length > 0), []);
});

test("every spelling of a stale reset is caught, and the empty sentinel is not", () => {
  for (const line of ["  _layoutMetrics = {};", "  _layoutMetrics = { };", "  _layoutMetrics = LayoutMetrics{};", "  layoutMetrics = LayoutMetrics();"]) {
    assert.deepEqual(staleResets(line), [line]);
  }
  assert.deepEqual(staleResets("  _layoutMetrics = EmptyLayoutMetrics;"), []);
  assert.deepEqual(staleResets("  _layoutMetrics = layoutMetrics;"), []);
});
