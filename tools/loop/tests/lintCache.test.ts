import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ESLINT = path.join(path.dirname(require.resolve("eslint/package.json")), "bin", "eslint.js");
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const lintScript: string = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).scripts.lint;
const flags = lintScript.split(" -- ")[1].split(/\s+/);

test("lint caches by content, and the cache is ignored", () => {
  assert.ok(flags.includes("--cache"), lintScript);
  assert.equal(flags[flags.indexOf("--cache-strategy") + 1], "content", "mtime misses an edit that keeps it");
  assert.match(fs.readFileSync(path.join(ROOT, ".gitignore"), "utf8"), /^\.eslintcache$/m);
});

test("a cached lint still reports an edit that keeps size and mtime, and a config change", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lint-cache-"));
  try {
    const config = (rules: object) =>
      fs.writeFileSync(path.join(dir, "eslint.config.mjs"), `export default [{ rules: ${JSON.stringify(rules)} }];\n`);
    const file = path.join(dir, "a.js");
    const write = (body: string) => {
      fs.writeFileSync(file, body);
      fs.utimesSync(file, 1_000_000, 1_000_000);
    };
    const lint = () => spawnSync(process.execPath, [ESLINT, ...flags, "a.js"], { cwd: dir, encoding: "utf8" });

    config({ "no-debugger": "error" });
    write("let x = 1;\n");
    assert.equal(lint().status, 0);
    assert.ok(fs.existsSync(path.join(dir, ".eslintcache")), "no cache was written");

    write("debugger;\n\n");
    for (const run of [lint(), lint()]) assert.match(run.stdout, /no-debugger/);

    write("let y = 2;\n");
    assert.equal(lint().status, 0);
    config({ "no-debugger": "error", "prefer-const": "error" });
    assert.match(lint().stdout, /prefer-const/, "a config change must invalidate the cached result");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
