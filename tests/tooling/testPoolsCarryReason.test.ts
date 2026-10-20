// A test reads the database through `TestServer.query`/`.db`; a pool of its own needs a reason.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { trackedFiles } from "../helpers/trackedFiles.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const OPENS_POOL = /new pg\.Pool\(/;
const TOOL_DIRECTIVE = /^(eslint|@ts-|prettier-|istanbul|c8\b|biome-)/;

/** A comment line that gives a reason: prose, not empty and not a directive to a tool. */
function isReason(line: string): boolean {
  if (line.endsWith("*/") && !line.startsWith("/*")) return true;
  if (!line.startsWith("//") && !line.startsWith("/*")) return false;
  const body = line.replace(/^\/[/*]+/, "").replace(/\*\/$/, "").trim();
  return body !== "" && !TOOL_DIRECTIVE.test(body);
}

/** Each pool a file opens in code (not in a string), and whether a reason sits on the line directly above it. */
function pools(text: string): { line: number; reasoned: boolean }[] {
  const lines = text.split("\n");
  return lines.flatMap((line, i) => {
    const at = line.search(OPENS_POOL);
    if (at < 0 || /["'`]/.test(line.slice(0, at))) return [];
    return [{ line: i + 1, reasoned: isReason((lines[i - 1] ?? "").trim()) }];
  });
}

test("the scan tells a reasoned pool from a bare, empty or directive-only one, and skips one in a string", () => {
  const planted = [
    "// the reason",
    "const a = new pg.Pool({});",
    "const b = 1;",
    "const c = new pg.Pool({});",
    'const d = "new pg.Pool({})";',
    "// eslint-disable-next-line no-new",
    "const e = new pg.Pool({});",
    "// @ts-expect-error",
    "const f = new pg.Pool({});",
    "//",
    "const g = new pg.Pool({});",
    "/* eslint-disable */",
    "const h = new pg.Pool({});",
  ].join("\n");
  assert.deepEqual(pools(planted), [
    { line: 2, reasoned: true },
    { line: 4, reasoned: false },
    { line: 7, reasoned: false },
    { line: 9, reasoned: false },
    { line: 11, reasoned: false },
    { line: 13, reasoned: false },
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
