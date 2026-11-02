import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const workflows = path.join(repoRoot, ".github", "workflows");
const actions = path.join(repoRoot, ".github", "actions");
const sources = readdirSync(workflows)
  .filter((n) => /\.ya?ml$/.test(n))
  .map((n) => [n, readFileSync(path.join(workflows, n), "utf8")] as const);
const withActions = [
  ...sources,
  ...readdirSync(actions).map((n) => [`${n}/action.yml`, readFileSync(path.join(actions, n, "action.yml"), "utf8")] as const),
];

test(".node-version names one Node major", () => {
  assert.match(readFileSync(path.join(repoRoot, ".node-version"), "utf8"), /^\d+\s*$/);
});

test("no workflow runs npm ci itself: the install action owns it", () => {
  for (const [name, source] of sources) {
    assert.doesNotMatch(source, /^\s*(?:- )?run: npm ci\b/m, name);
  }
});

test("no workflow or action overrides .node-version", () => {
  assert.ok(withActions.some(([name]) => name === "install/action.yml"), "the install action is not read");
  for (const [name, source] of withActions) {
    assert.doesNotMatch(source, /\bnode-version:/, name);
  }
});

test("a direct setup-node reads .node-version", () => {
  let seen = 0;
  for (const [name, source] of withActions) {
    for (const use of source.matchAll(/setup-node@[^\n]*\n(\s*with:\n(?:\s+[\w-]+:[^\n]*\n)+)?/g)) {
      seen += 1;
      assert.ok(use[1], `${name}: a setup-node step has no with: block`);
      assert.match(use[1], /node-version-file: \.node-version/, name);
    }
  }
  assert.ok(seen > 0, "no direct setup-node step is seen");
});
