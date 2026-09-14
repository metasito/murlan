// tests/sourceScan.test.ts — the blanking helpers every source scan is built
// on. A helper that blanks too much reports the tree clean by not reading it,
// so the last test here is a floor: a scan that swallows its input fails.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { blankComments, blankCommentsAndStrings } from "./helpers/sourceScan.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("an apostrophe inside a double-quoted string is content, not an opener", () => {
  const src = `const a = "the pile's catch";\nreaddirSync(repoRoot);\nconst b = "done's";`;
  const out = blankCommentsAndStrings(src);

  assert.match(out, /readdirSync\(repoRoot\);/);
  assert.ok(!out.includes("pile"), out);
  assert.ok(!out.includes("done"), out);
});

test("a double quote inside a single-quoted string is content, not an opener", () => {
  const src = `const a = 'the "pile" catch';\nreaddirSync(repoRoot);\nconst b = 'a "b"';`;
  const out = blankCommentsAndStrings(src);

  assert.match(out, /readdirSync\(repoRoot\);/);
  assert.ok(!out.includes("pile"), out);
});

test("an apostrophe inside a template literal is content, not an opener", () => {
  const src = "const a = `the pile's catch`;\nreaddirSync(repoRoot);\nconst b = `done's`;";
  const out = blankCommentsAndStrings(src);

  assert.match(out, /readdirSync\(repoRoot\);/);
  assert.ok(!out.includes("pile"), out);
});

test("a template's ${} holds code, and its own literals are blanked", () => {
  const src = "const a = `x ${fn(\"y's\")} z`;";
  const out = blankCommentsAndStrings(src);

  assert.match(out, /fn\(/);
  assert.ok(!out.includes("y's"), out);
});

test("an escaped quote does not close the literal", () => {
  const src = `const a = 'it\\'s';\nreaddirSync(repoRoot);`;
  const out = blankCommentsAndStrings(src);

  assert.match(out, /readdirSync\(repoRoot\);/);
  assert.ok(!out.includes("it"), out);
});

test("an unclosed quote ends at the line break, as the language says it does", () => {
  const src = `<Text>don't</Text>\nreaddirSync(repoRoot);`;

  assert.match(blankCommentsAndStrings(src), /readdirSync\(repoRoot\);/);
});

test("a /* inside a string does not open a comment", () => {
  const src = `const a = "agent/* worktree";\nreaddirSync(repoRoot);\nconst b = "x */ y";`;

  assert.match(blankComments(src), /readdirSync\(repoRoot\);/);
  assert.match(blankCommentsAndStrings(src), /readdirSync\(repoRoot\);/);
});

test("a // inside a regex literal does not open a comment", () => {
  const src = `const a = s.replace(/\\/\\*[\\s\\S]*?\\*\\//g, ""); readdirSync(repoRoot);`;

  assert.match(blankComments(src), /readdirSync\(repoRoot\);/);
  assert.match(blankComments(src), /replace\(/);
});

test("a JSX closing tag is not a regex literal", () => {
  const src = `<View>\n  <Text>{label}</Text>\n</View>;\nreaddirSync(repoRoot);`;

  assert.equal(blankComments(src), src);
  assert.match(blankCommentsAndStrings(src), /readdirSync\(repoRoot\);/);
});

test("comments still go, and a URL's // stays", () => {
  const out = blankComments(`const a = 1; // gone\n/* also\ngone */\nconst u = "https://x";`);

  assert.ok(!out.includes("gone"), out);
  assert.match(out, /const a = 1;/);
  assert.match(out, /https:\/\/x/);
});

test("blanking preserves every offset, so a scan can name the line it found", () => {
  for (const [, src] of sources()) {
    for (const out of [blankComments(src), blankCommentsAndStrings(src)]) {
      assert.equal(out.length, src.length);
      assert.equal(out.split("\n").length, src.split("\n").length);
    }
  }
});

/**
 * The floor, and it is every one of them: a declaration at column 0 is code no
 * blanking may touch. A share of the non-whitespace is the weaker floor it
 * looks like — across this corpus the defect this file fixes moved the
 * comments-only share by 0.3 points, from 69.0% to 69.3%, so any share a
 * comment-heavy file can pass a runaway can pass too. This one counted 8 files
 * losing a declaration to `blankComments` and 48 to `blankCommentsAndStrings`.
 *
 * Commented-out code at column 0, or a fixture holding a whole module in a
 * template literal, fails it honestly; indent either one.
 */
const TOP_LEVEL = /^(?:import|export|const|function|async function|class|type|interface)\b/gm;

test("blanking leaves every top-level declaration behind", () => {
  const eaten: string[] = [];
  for (const [file, src] of sources()) {
    const want = src.match(TOP_LEVEL)?.length ?? 0;
    if (!want) continue;
    for (const [name, blanked] of [
      ["blankComments", blankComments(src)],
      ["blankCommentsAndStrings", blankCommentsAndStrings(src)],
    ] as const) {
      const got = blanked.match(TOP_LEVEL)?.length ?? 0;
      if (got < want) eaten.push(`${file}: ${name} kept ${got} of ${want}`);
    }
  }
  assert.deepEqual(eaten, []);
});

/** Every scanned source in the trees the helpers are pointed at. */
function sources(): [string, string][] {
  const out: [string, string][] = [];
  for (const dir of ["app", "components", "lib", "tests", "scripts", "tools", "server"]) {
    for (const f of readdirSync(path.join(repoRoot, dir), { recursive: true, encoding: "utf8" })) {
      if (!/\.(ts|tsx|mjs|js)$/.test(f)) continue;
      const rel = `${dir}/${f.split(path.sep).join("/")}`;
      out.push([rel, readFileSync(path.join(repoRoot, rel), "utf8")]);
    }
  }
  return out;
}
