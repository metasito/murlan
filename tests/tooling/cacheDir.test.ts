import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { cacheBase, cacheFor, sharedCheckout } from "../helpers/cacheDir.ts";

const PROBE = path.join("tests", "probe.test.ts");

function sandbox() {
  const dir = mkdtempSync(path.join(tmpdir(), "murlan-cachedir-"));
  const root = path.join(dir, "repo");
  const base = path.join(dir, "cache");
  const files: Record<string, string> = {
    "package-lock.json": '{"lockfileVersion":3}',
    "patches/some-lib+1.0.0.patch": "--- a\n+++ b\n",
    "babel.config.js": "module.exports = {};",
    "eslint.config.js": "module.exports = [];",
    "eslint.guards.cjs": "module.exports = {};",
    "eslint.selectors.cjs": "module.exports = {};",
    [PROBE]: "transformSync(source, {});",
  };
  const write = (rel: string, text: string) => {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), text);
  };
  for (const [rel, text] of Object.entries(files)) write(rel, text);
  const use = () => cacheFor("probe", [path.join(root, PROBE)], { root, base });
  return { dir, root, base, files, write, use, done: () => rmSync(dir, { recursive: true, force: true }) };
}

test("every key input moves the cache to a new directory", () => {
  const box = sandbox();
  try {
    const seen = new Set([box.use()]);
    const edits: [string, string][] = [
      ...Object.keys(box.files).map((rel): [string, string] => [rel, `${box.files[rel]}\n// edited`]),
      ["patches/another-lib+2.0.0.patch", "+ added\n"],
      ["eslint.newrules.cjs", "module.exports = {};"],
    ];
    for (const [rel, text] of edits) {
      box.write(rel, text);
      const dir = box.use();
      assert.ok(!seen.has(dir), `editing ${rel} left the cache key where it was`);
      seen.add(dir);
    }
    assert.equal(box.use(), [...seen].at(-1), "the same inputs give the same directory");
  } finally {
    box.done();
  }
});

test("a key's directory replaces the one before it", () => {
  const box = sandbox();
  try {
    const before = box.use();
    box.write("package-lock.json", '{"lockfileVersion":3,"packages":{}}');
    const after = box.use();
    assert.ok(!existsSync(before), "the superseded key's directory was left behind");
    assert.deepEqual(readdirSync(path.join(box.base, "probe")), [path.basename(after)]);
  } finally {
    box.done();
  }
});

test("a result cached clean is not served once an installed version changes", () => {
  const box = sandbox();
  try {
    writeFileSync(path.join(box.use(), "result.json"), "[]");
    box.write("package-lock.json", '{"lockfileVersion":3,"packages":{"node_modules/eslint-plugin-react-hooks":{"version":"7.1.1"}}}');
    assert.ok(!existsSync(path.join(box.use(), "result.json")), "the clean result outlived a lockfile change");
  } finally {
    box.done();
  }
});

test("the cache lives in a real install, never in a node_modules it would have to create", () => {
  const base = cacheBase();
  const install = path.dirname(base);
  if (path.basename(install) === "node_modules") {
    assert.ok(existsSync(path.join(install, ".package-lock.json")), `${install} is not an install`);
  } else {
    assert.ok(base.startsWith(tmpdir()), `${base} is neither an install's cache nor the temp dir`);
  }
  assert.ok(existsSync(path.join(sharedCheckout(), ".git")), "the shared checkout holds no .git");
});
