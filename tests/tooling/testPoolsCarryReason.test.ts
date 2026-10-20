// A test reads the database through `TestServer.query`/`.db`; a pool of its own needs a reason.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { trackedFiles } from "../helpers/trackedFiles.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const OPENS_POOL = /new pg\.Pool\(/;

/** Each pool a file opens in code (not in a string), and whether a comment line sits directly above it. */
function pools(text: string): { line: number; reasoned: boolean }[] {
  const lines = text.split("\n");
  return lines.flatMap((line, i) => {
    const at = line.search(OPENS_POOL);
    if (at < 0 || /["'`]/.test(line.slice(0, at))) return [];
    const above = (lines[i - 1] ?? "").trim();
    return [{ line: i + 1, reasoned: above.startsWith("//") || above.endsWith("*/") }];
  });
}

test("the scan tells a reasoned pool from a bare one, and skips one in a string", () => {
  const planted = [
    "// the reason",
    "const a = new pg.Pool({});",
    "const b = 1;",
    "const c = new pg.Pool({});",
    'const d = "new pg.Pool({})";',
  ].join("\n");
  assert.deepEqual(pools(planted), [
    { line: 2, reasoned: true },
    { line: 4, reasoned: false },
  ]);
});

test("every pool a test opens of its own carries a reason on the line above", () => {
  const found = trackedFiles(REPO_ROOT, "tests", "tools")
    .filter((f) => /\.(ts|mts|mjs)$/.test(f))
    .flatMap((f) => pools(readFileSync(path.join(REPO_ROOT, f), "utf8")).map((p) => ({ file: f, ...p })));

  // RULES §6: a scan that finds nothing passes.
  assert.ok(found.length >= 10, `only ${found.length} pools found — the scan has stopped seeing them`);
  const bare = found.filter((p) => !p.reasoned).map((p) => `${p.file}:${p.line}`);
  assert.deepEqual(bare, [], "these open a pool beside the test server's with no reason given");
});
