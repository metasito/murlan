// tests/sourceScan.test.ts — the blanking helpers every source scan is built
// on. A helper that blanks too much reports the tree clean by not reading it,
// so the corpus tests below read every scanned tree rather than a fixture.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { blankComments, blankCommentsAndStrings, sourcesUnder } from "./helpers/sourceScan.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Every scanned source in the trees the helpers are pointed at. */
const sources = () =>
  sourcesUnder(repoRoot, ["app", "components", "lib", "tests", "scripts", "tools", "server"], /\.(tsx?|m?js)$/);

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

test("an unterminated template literal is reported, not silently erased", () => {
  const src = "const a = `x;\nscanSources(pattern);\n";

  assert.throws(() => blankCommentsAndStrings(src), /unterminated template literal/);
  assert.throws(() => blankComments(src), /unterminated template literal/);
});

test("an unterminated block comment is reported, not silently erased", () => {
  const src = "const a = 1;\n/* x\nscanSources(pattern);\n";

  assert.throws(() => blankCommentsAndStrings(src), /unterminated block comment at line 2/);
  assert.throws(() => blankComments(src), /unterminated block comment at line 2/);
});

// A quote's other closer is the line break, which the test above this one
// states — so the only string that reaches the end of the input is one on the
// last line of a file that does not end in a newline.
test("a string literal left open at the end of the input is reported", () => {
  assert.throws(() => blankCommentsAndStrings(`const a = "x`), /unterminated string literal at line 1/);
  assert.throws(() => blankComments(`const a = "x`), /unterminated string literal at line 1/);
  assert.doesNotThrow(() => blankCommentsAndStrings(`const a = "x"`));
  assert.doesNotThrow(() => blankCommentsAndStrings(`const a = "x\nconst b = 2;`));
});

/** The index of the last character `blankCommentsAndStrings` left standing. */
function lastKept(src: string): number {
  const out = blankCommentsAndStrings(src);
  for (let i = src.length - 1; i >= 0; i--) if (out[i] === src[i] && src[i].trim()) return i;
  return -1;
}

/**
 * The counterfactual, over real files rather than a fixture: an unterminated
 * backtick planted at the top of a scanned file.
 *
 * No file here is classified by whether the floor fired. A plant the floor let
 * through has to show the last character the clean blanking kept still
 * standing — so a floor that never fires fails this — and a floor that fired
 * on everything instead reds `no file any scan reads has a construct the
 * blanking ran off the end of`, where the tree as it is must blank without a
 * word. Nothing is exempt: the files whose plant closes again on their own
 * next backtick pass because that character does survive, not because they
 * were excused. What those plants still erase above it is read by `blanking
 * leaves every top-level declaration behind`.
 */
test("a backtick planted at the top of a scanned file reds the floor", () => {
  const missed: string[] = [];
  let reported = 0;
  for (const [file, src] of sources()) {
    const kept = lastKept(src);
    if (kept < 0) continue;
    try {
      // `kept + 2` is the same character of the same file: the plant is two long.
      if (blankCommentsAndStrings("`\n" + src)[kept + 2] !== src[kept]) missed.push(file);
    } catch (e) {
      // Read the report, rather than counting the throw: a TypeError out of the
      // walker is not this floor firing, and would otherwise pass for it.
      assert.match((e as Error).message, /^unterminated /, file);
      reported++;
    }
  }
  assert.deepEqual(missed, [], `${missed.length} files lost their tail with nothing reported`);
  assert.ok(reported > 0, "no planted backtick was reported, so this test asserted nothing");
});

// One mode, because reporting is outside every `blankStrings` branch — which
// the two fixtures above assert of both modes, where a corpus walk is free.
test("no file any scan reads has a construct the blanking ran off the end of", () => {
  const unclosed: string[] = [];
  for (const [file, src] of sources()) {
    try {
      blankCommentsAndStrings(src);
    } catch (e) {
      unclosed.push(`${file}: ${(e as Error).message}`);
    }
  }
  assert.deepEqual(unclosed, []);
});

// The shape no file in the corpus has: blanking `a="b"` leaves an `=` in the
// buffer, and a lookbehind reading the buffer rather than the source takes the
// `/` of `/>` for a regex opener — in one of the two modes only.
test("a blanked attribute does not turn the slash of /> into a regex opener", () => {
  const src = `const x = <Foo a="b" />; // hidden`;

  assert.ok(!blankCommentsAndStrings(src).includes("hidden"), blankCommentsAndStrings(src));
});

// Every span the one pass blanks for a comment it blanks in both modes, so a
// disagreement about where a construct begins cannot leave one of them behind.
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
 * Commented-out code at column 0 fails it honestly; indent it. A fixture
 * holding a module in a template literal does not, because what the string
 * mode is held to is what the comment mode kept — not the raw source.
 */
const TOP_LEVEL = /^(?:import|export|const|function|async function|class|type|interface)\b/gm;

test("blanking leaves every top-level declaration behind", () => {
  const eaten: string[] = [];
  const declarations = (s: string) => s.match(TOP_LEVEL)?.length ?? 0;
  for (const [file, src] of sources()) {
    const comments = blankComments(src);
    for (const [name, want, got] of [
      ["blankComments", declarations(src), declarations(comments)],
      ["blankCommentsAndStrings", declarations(comments), declarations(blankCommentsAndStrings(src))],
    ] as const) {
      if (got < want) eaten.push(`${file}: ${name} kept ${got} of ${want}`);
    }
  }
  assert.deepEqual(eaten, []);
});
