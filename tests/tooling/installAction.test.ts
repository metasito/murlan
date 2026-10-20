import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const workflows = path.join(repoRoot, ".github", "workflows");
const sources = readdirSync(workflows)
  .filter((n) => /\.ya?ml$/.test(n))
  .map((n) => [n, readFileSync(path.join(workflows, n), "utf8")] as const);
const production = String(JSON.parse(readFileSync(path.join(repoRoot, "deploy", "runtime.json"), "utf8")).node);

test(".node-version names one Node major", () => {
  assert.match(readFileSync(path.join(repoRoot, ".node-version"), "utf8"), /^\d+\s*$/);
});

test("no workflow runs npm ci itself: the install action owns it", () => {
  for (const [name, source] of sources) {
    assert.doesNotMatch(source, /^\s*(?:- )?run: npm ci\b/m, name);
  }
});

test("a Node version is spelled only where it must be production's", () => {
  for (const [name, source] of sources) {
    for (const spelled of source.matchAll(/node-version:\s*["']?(\d+)/g)) {
      assert.equal(spelled[1], production, `${name} pins Node ${spelled[1]} but is not production's ${production}`);
    }
  }
});

test("a direct setup-node reads .node-version", () => {
  for (const [name, source] of sources) {
    for (const use of source.matchAll(/setup-node@[^\n]*\n\s*with:\n((?:\s+[\w-]+:[^\n]*\n)+)/g)) {
      assert.match(use[1]!, /node-version-file: \.node-version/, name);
    }
  }
});
