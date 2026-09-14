// tests/sourceScan.test.ts — the blanking helpers every source scan is built
// on. A helper that blanks too much reports the tree clean by not reading it,
// which is what "blanking leaves every top-level declaration behind" refuses.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { blankComments, blankCommentsAndStrings, sourcesUnder } from "./helpers/sourceScan.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("an apostrophe inside a double-quoted string is content, not an opener", () => {
  const src = `const a = "the pile's catch";\nscanSources(pattern);\nconst b = "done's";`;
  const out = blankCommentsAndStrings(src);

  assert.match(out, /scanSources\(pattern\);/);
  assert.ok(!out.includes("pile"), out);
  assert.ok(!out.includes("done"), out);
});

test("a double quote inside a single-quoted string is content, not an opener", () => {
  const src = `const a = 'the "pile" catch';\nscanSources(pattern);\nconst b = 'a "b"';`;
  const out = blankCommentsAndStrings(src);

  assert.match(out, /scanSources\(pattern\);/);
  assert.ok(!out.includes("pile"), out);
});

test("an apostrophe inside a template literal is content, not an opener", () => {
  const src = "const a = `the pile's catch`;\nscanSources(pattern);\nconst b = `done's`;";
  const out = blankCommentsAndStrings(src);

  assert.match(out, /scanSources\(pattern\);/);
  assert.ok(!out.includes("pile"), out);
});

test("a template's ${} holds code, and its own literals are blanked", () => {
  const src = "const a = `x ${fn(\"y's\")} z`;";
  const out = blankCommentsAndStrings(src);

  assert.match(out, /fn\(/);
  assert.ok(!out.includes("y's"), out);
});

test("an escaped quote does not close the literal", () => {
  const src = `const a = 'it\\'s';\nscanSources(pattern);`;
  const out = blankCommentsAndStrings(src);

  assert.match(out, /scanSources\(pattern\);/);
  assert.ok(!out.includes("it"), out);
});

// An apostrophe in JSX prose is not a string opener, but nothing here reads
// JSX, so `blankCommentsAndStrings` takes the rest of its line. The line break
// is the whole of the bound, and this states what it costs.
test("an unclosed quote ends at the line break, and takes the rest of that line", () => {
  const src = `<Text>don't <Modal /> now</Text>\nscanSources(pattern);`;
  const out = blankCommentsAndStrings(src);

  assert.match(out, /scanSources\(pattern\);/);
  assert.ok(!out.includes("<Modal />"), out);
});

// Every span the one pass blanks for a comment it blanks in both modes, so the
// two exports cannot disagree about where a construct begins.
test("blanking strings blanks a superset of blanking comments", () => {
  const disagreed: string[] = [];
  for (const [file, src] of sources()) {
    const comments = blankComments(src);
    const both = blankCommentsAndStrings(src);
    for (let i = 0; i < src.length; i++) {
      if (comments[i] !== src[i] && both[i] === src[i]) {
        disagreed.push(`${file}: offset ${i} survives blankCommentsAndStrings`);
        break;
      }
    }
  }
  assert.deepEqual(disagreed, []);
});

test("a /* inside a string does not open a comment", () => {
  const src = `const a = "agent/* worktree";\nscanSources(pattern);\nconst b = "x */ y";`;

  assert.match(blankComments(src), /scanSources\(pattern\);/);
  assert.match(blankCommentsAndStrings(src), /scanSources\(pattern\);/);
});

test("a // inside a regex literal does not open a comment", () => {
  const src = `const a = s.replace(/\\/\\*[\\s\\S]*?\\*\\//g, ""); scanSources(pattern);`;

  assert.match(blankComments(src), /scanSources\(pattern\);/);
  assert.match(blankComments(src), /replace\(/);
});

test("a JSX closing tag is not a regex literal", () => {
  const src = `<View>\n  <Text>{label}</Text>\n</View>;\nscanSources(pattern);`;

  assert.equal(blankComments(src), src);
  assert.match(blankCommentsAndStrings(src), /scanSources\(pattern\);/);
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
 * The floor: a declaration at column 0 is code no blanking may touch. A share
 * of the non-whitespace is the weaker floor it looks like — a runaway passes
 * any share a legitimately comment-heavy file has to be allowed to pass.
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
const sources = () =>
  sourcesUnder(repoRoot, ["app", "components", "lib", "tests", "scripts", "tools", "server"], /\.(tsx?|m?js)$/);
