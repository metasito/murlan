// tools/loop/tests/commentShape.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ARCHEOLOGY, HISTORY, classify, floorFor, violations } from "../commentShape.ts";

const kinds = (text: string, path = "src/x.ts") => classify(text, path).map((l) => l.kind);
const rules = (text: string) => violations(text, "src/x.ts").map((v) => v.rule);

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
    assert.deepEqual(classify("\n   const x = 1;", "src/x.ts")[1], { n: 2, text: "const x = 1;", kind: "code" });
  });

  test("a workflow and a script take # as their comment marker, blank lines included", () => {
    assert.deepEqual(kinds(["#!/bin/sh", "# why", "", "on: push"].join("\n"), "ci.yml"), ["code", "comment", "blank", "code"]);
    assert.deepEqual(kinds("# why", "x.yaml"), ["comment"]);
    assert.deepEqual(kinds("# why", "x.sh"), ["comment"]);
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

describe("the floor both enforcers compare on", () => {
  test("floorFor names the two budgets", () => {
    assert.equal(floorFor("src/x.ts"), 6);
    assert.equal(floorFor("tools/loop/tests/x.test.ts"), 3);
    assert.equal(floorFor("tests/native/Hand.test.tsx"), 3);
  });

  /**
   * Ratio is a property of what a change adds, so it needs a base revision and is judged by
   * `comment-budget.mjs` and the write-time hook, never here. Nothing but history is reported.
   */
  test("a file that is nothing but prose raises no violation of its own", () => {
    const prose = Array.from({ length: 40 }, (_, i) => `// line ${i} of prose`);
    assert.deepEqual(rules([...prose, "const x = 1;"].join("\n")), []);
  });
});

/**
 * It reads one write. A comment arriving any other way is `comment-budget.mjs`'s to catch from
 * committed bytes — which is what keeps the pair from being a guard that passes by not looking.
 */
test("code alone is clean", () => {
  assert.deepEqual(rules("const x = 1;"), []);
});
