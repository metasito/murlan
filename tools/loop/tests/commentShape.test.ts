// tools/loop/tests/commentShape.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ARCHEOLOGY, HISTORY, classify, floorFor, violations } from "../commentShape.ts";

const kinds = (text: string) => classify(text).map((l) => l.kind);
const rules = (text: string, path = "src/x.ts") => violations(text, path).map((v) => v.rule);

describe("classify", () => {
  test("names each line comment, code or blank", () => {
    assert.deepEqual(kinds(["// why", "const x = 1;", "", "let y;"].join("\n")), ["comment", "code", "blank", "code"]);
  });

  test("a block comment is comment to its closing line, blank interior included", () => {
    assert.deepEqual(kinds(["/**", " * why.", "", " */", "const x = 1;"].join("\n")),
      ["comment", "comment", "comment", "comment", "code"]);
  });

  test("a one-line block comment does not open a block", () => {
    assert.deepEqual(kinds(["/* why */", "const x = 1;"].join("\n")), ["comment", "code"]);
  });

  test("comment syntax inside a string is code", () => {
    assert.deepEqual(kinds(`const s = "// not a comment";`), ["code"]);
    assert.deepEqual(kinds("const s = '/* nor this */';"), ["code"]);
  });

  /**
   * The guard must not refuse the file that defines it. Its own phrase list and these very cases are
   * `//` inside string literals, so a classifier blind to strings would make its tests unwritable.
   */
  test("a quoted example of a forbidden comment is code, not a forbidden comment", () => {
    assert.deepEqual(rules(`const bad = "// previously this returned null";`), []);
  });

  test("a string holding a block opener does not open a block", () => {
    assert.deepEqual(kinds([`const s = "/*";`, "const x = 1;"].join("\n")), ["code", "code"]);
  });

  /** Known limit, pinned so it is a boundary and not a surprise. See `blankStrings`. */
  test("a line inside a multi-line template literal can read as a comment", () => {
    assert.deepEqual(kinds(["const s = `", "// inside a template", "`;"].join("\n")), ["code", "comment", "code"]);
  });

  test("text is trimmed, and the line number is one-based", () => {
    assert.deepEqual(classify("\n   const x = 1;")[1], { n: 2, text: "const x = 1;", kind: "code" });
  });
});

describe("the archeology list", () => {
  test("every phrase in it is one the rule actually catches", () => {
    for (const phrase of ARCHEOLOGY) {
      assert.ok(HISTORY.test(`// ${phrase} something`), `"${phrase}" is in the list but matches nothing`);
    }
  });

  test("holds plain phrases, so one entry cannot reshape the pattern", () => {
    for (const phrase of ARCHEOLOGY) {
      assert.doesNotMatch(phrase, /[\\^$.|?*+()[\]{}]/, `"${phrase}" carries a regex metacharacter`);
    }
  });
});

describe("the history rule", () => {
  for (const line of [
    "// previously this returned null",
    "// this used to call the old helper",
    "/* the bug was that the socket closed early */",
    "// we now read the window's short edge",
    "// renamed from checkoutRoot",
    "// no longer needed after the rewrite",
  ]) {
    test(`flags ${JSON.stringify(line)}`, () => {
      assert.deepEqual(rules([line, "const x = 1;"].join("\n")), ["history"]);
    });
  }

  for (const line of [
    "// the socket is no longer connected once the handshake fails",
    "// iOS does not paint in tree order, so the layer is stated",
    "// Reading, not Motion: this is how long a banner stays legible",
    "// the server validates every move before it broadcasts",
  ]) {
    test(`leaves ${JSON.stringify(line)} alone`, () => {
      assert.deepEqual(rules([line, "const x = 1;"].join("\n")), []);
    });
  }
});

describe("the ratio rule", () => {
  const prose = (n: number) => Array.from({ length: n }, (_, i) => `// line ${i} of prose`);

  test("more comment than code, above the floor", () => {
    assert.deepEqual(rules([...prose(8), "const x = 1;"].join("\n")), ["ratio"]);
  });

  test("a long docblock over a long function is not a violation", () => {
    const code = Array.from({ length: 20 }, (_, i) => `const v${i} = ${i};`);
    assert.deepEqual(rules([...prose(8), ...code].join("\n")), []);
  });

  test("a handful of comments on a small change is not a ratio worth policing", () => {
    assert.deepEqual(rules([...prose(3), "const x = 1;"].join("\n")), []);
  });

  test("blank lines count as neither, in either column", () => {
    assert.deepEqual(rules([...prose(4), "", "", "const x = 1;"].join("\n")), []);
  });

  test("a blank line inside a block comment is comment, not a discount on it", () => {
    const block = ["/**", ...Array.from({ length: 6 }, () => " * prose."), "", " */", "const x = 1;"];
    assert.deepEqual(rules(block.join("\n")), ["ratio"]);
  });

  test("a test file gets the tighter floor", () => {
    const text = [...prose(4), "const x = 1;"].join("\n");
    assert.deepEqual(rules(text, "src/x.ts"), []);
    assert.deepEqual(rules(text, "tools/loop/tests/x.test.ts"), ["ratio"]);
  });

  test("floorFor names the two budgets", () => {
    assert.equal(floorFor("src/x.ts"), 6);
    assert.equal(floorFor("tools/loop/tests/x.test.ts"), 3);
    assert.equal(floorFor("tests/native/Hand.test.tsx"), 3);
  });
});

/**
 * It reads one write. A comment arriving any other way is `comment-budget.mjs`'s to catch from
 * committed bytes — which is what keeps the pair from being a guard that passes by not looking.
 */
test("code alone is clean", () => {
  assert.deepEqual(rules("const x = 1;"), []);
});
