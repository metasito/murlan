import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel: string) => readFileSync(path.join(repoRoot, rel), "utf8");

// Resolved, never `node_modules/` under repoRoot: a worktree has no install of its own (RULES.md rule 9).
const reactNative = path.dirname(createRequire(import.meta.url).resolve("react-native/package.json"));
const MOUNTING = path.relative(repoRoot, path.join(reactNative, "React/Fabric/Mounting/ComponentViews")).replaceAll("\\", "/");
const VIEW = `${MOUNTING}/View/RCTViewComponentView.mm`;

/** A layout reset other than EmptyLayoutMetrics: a recycled view next laid out at exactly it is never moved (#1485). */
const STALE_RESET = /\b_?layoutMetrics\s*=\s*(?:\{\s*\}|LayoutMetrics\s*\{\s*\}|LayoutMetrics\(\s*\))\s*;/;

function staleResets(source: string): string[] {
  return source.split("\n").filter((line) => STALE_RESET.test(line));
}

const walk = (dir: string): string[] =>
  readdirSync(path.join(repoRoot, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(`${dir}/${e.name}`) : /\.mm?$/.test(e.name) ? [`${dir}/${e.name}`] : []
  );

test("no installed component view resets a recycled view's layout stale (#1485, react/react-native#57590)", () => {
  const files = walk(MOUNTING);
  assert.ok(files.includes(VIEW), "the scan no longer reaches RCTViewComponentView.mm");
  assert.deepEqual(files.filter((f) => staleResets(read(f)).length > 0), []);
});

test("RCTViewComponentView's prepareForRecycle forgets the layout with EmptyLayoutMetrics", () => {
  const body = /- \(void\)prepareForRecycle\s*\{([\s\S]*?)\n\}/.exec(read(VIEW))?.[1];
  assert.ok(body, "RCTViewComponentView no longer defines prepareForRecycle");
  assert.match(body, /\b_layoutMetrics = EmptyLayoutMetrics;/);
});

test("every spelling of a stale reset is caught, and the empty sentinel is not", () => {
  for (const line of ["  _layoutMetrics = {};", "  _layoutMetrics = { };", "  _layoutMetrics = LayoutMetrics{};", "  layoutMetrics = LayoutMetrics();"]) {
    assert.deepEqual(staleResets(line), [line]);
  }
  assert.deepEqual(staleResets("  _layoutMetrics = EmptyLayoutMetrics;"), []);
  assert.deepEqual(staleResets("  _layoutMetrics = layoutMetrics;"), []);
});
