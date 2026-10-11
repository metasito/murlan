// tools/loop/tests/commentShape.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { classify } from "../commentShape.ts";

const kinds = (text: string, path = "src/x.ts") => classify(text, path).map((l) => l.kind);

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

  test("a comment marker inside a string literal is code, not a comment", () => {
    assert.deepEqual(kinds(`const bad = "// previously this returned null";`), ["code"]);
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
