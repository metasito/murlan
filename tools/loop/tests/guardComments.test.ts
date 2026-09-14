// tools/loop/tests/guardComments.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { decide } from "../guard-comments.mjs";

const write = (content: string, file_path = "src/x.ts") =>
  ({ tool_name: "Write", tool_input: { file_path, content } }) as never;
const edit = (new_string: string, file_path = "src/x.ts") =>
  ({ tool_name: "Edit", tool_input: { file_path, old_string: "", new_string } }) as never;

describe("decide", () => {
  test("a clean write passes", () => {
    assert.deepEqual(decide(write("const x = 1;")), { deny: false });
  });

  test("a history comment is denied, and the reason quotes the line", () => {
    const out = decide(write(["// previously this returned null", "const x = 1;"].join("\n")));
    assert.equal(out.deny, true);
    assert.match(out.reason ?? "", /previously this returned null/);
    assert.match(out.reason ?? "", /commit message/);
  });

  test("an Edit is judged on new_string, which is the text being added", () => {
    assert.equal(decide(edit(["// we now read the short edge", "const x = 1;"].join("\n"))).deny, true);
  });

  /**
   * A fragment has no ratio. A docblock added above an existing function is all comment and no code,
   * and is exactly what CLAUDE.md's four exceptions allow — denying it would teach the model to
   * write worse comments, not fewer.
   */
  test("an Edit adding only a docblock is not denied for its ratio", () => {
    const block = ["/**", ...Array.from({ length: 8 }, () => " * an invariant the types cannot carry."), " */"];
    assert.deepEqual(decide(edit(block.join("\n"))), { deny: false });
  });

  test("the same text written as a whole file is denied", () => {
    const block = ["/**", ...Array.from({ length: 8 }, () => " * prose."), " */", "const x = 1;"];
    assert.equal(decide(write(block.join("\n"))).deny, true);
  });

  test("an Edit still cannot smuggle history in", () => {
    assert.equal(decide(edit("// previously this returned null")).deny, true);
  });

  test("every violation is reported, not just the first", () => {
    const out = decide(write(["// previously null", "// we now return 1", "const x = 1;"].join("\n")));
    assert.match(out.reason ?? "", /previously null/);
    assert.match(out.reason ?? "", /we now return 1/);
  });

  test("a tool this hook does not judge passes untouched", () => {
    assert.deepEqual(decide({ tool_name: "Read", tool_input: { file_path: "src/x.ts" } } as never), { deny: false });
  });

  test("a file type with no comments of this shape passes", () => {
    assert.deepEqual(decide(write("# previously this was yaml", "docs/x.md")), { deny: false });
  });

  test("a malformed payload never disturbs the tool call", () => {
    for (const bad of [null, {}, { tool_name: "Write" }, { tool_name: "Write", tool_input: {} },
                       { tool_name: "Write", tool_input: { file_path: "src/x.ts", content: 7 } }]) {
      assert.deepEqual(decide(bad as never), { deny: false });
    }
  });
});
