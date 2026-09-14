// tools/loop/tests/guardComments.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { decide, io } from "../guard-comments.mjs";

type Tree = { committed: () => string; disk: () => string | null };

/** A tree with one file, at `head` in git and `now` on disk. */
const tree = (head = "", now = head): Tree => ({ committed: () => head, disk: () => now });
const nothing: Tree = { committed: () => "", disk: () => null };

const write = (content: string, file_path = "src/x.ts", at: Tree = nothing) =>
  decide({ tool_name: "Write", tool_input: { file_path, content } } as never, at);
/** `old_string: ""` puts the text at the head of the file, so it carries its own line ending. */
const edit = (new_string: string, file_path = "src/x.ts", at: Tree = nothing) =>
  decide({ tool_name: "Edit", tool_input: { file_path, old_string: "", new_string: `${new_string}\n` } } as never, at);

describe("decide", () => {
  test("a clean write passes", () => {
    assert.deepEqual(write("const x = 1;"), { deny: false });
  });

  test("a history comment is denied, and the reason quotes the line", () => {
    const out = write(["// previously this returned null", "const x = 1;"].join("\n"));
    assert.equal(out.deny, true);
    assert.match(out.reason ?? "", /previously this returned null/);
    assert.match(out.reason ?? "", /commit message/);
  });

  test("an Edit is judged on new_string, which is the text being added", () => {
    assert.equal(edit(["// we now read the short edge", "const x = 1;"].join("\n")).deny, true);
  });

  test("an Edit still cannot smuggle history in", () => {
    assert.equal(edit("// previously this returned null").deny, true);
  });

  test("the same text written as a whole file is denied for its ratio", () => {
    const block = ["/**", ...Array.from({ length: 8 }, () => " * prose."), " */", "const x = 1;"];
    assert.equal(write(block.join("\n")).deny, true);
  });

  test("every violation is reported, not just the first", () => {
    const out = write(["// previously null", "// we now return 1", "const x = 1;"].join("\n"));
    assert.match(out.reason ?? "", /previously null/);
    assert.match(out.reason ?? "", /we now return 1/);
  });

  test("a tool this hook does not judge passes untouched", () => {
    assert.deepEqual(decide({ tool_name: "Read", tool_input: { file_path: "src/x.ts" } } as never, nothing), { deny: false });
  });

  test("a file type with no comments of this shape passes", () => {
    assert.deepEqual(write("# previously this was yaml", "docs/x.md"), { deny: false });
  });

  test("a malformed payload never disturbs the tool call", () => {
    for (const bad of [null, {}, { tool_name: "Write" }, { tool_name: "Write", tool_input: {} },
                       { tool_name: "Write", tool_input: { file_path: "src/x.ts", content: 7 } }]) {
      assert.deepEqual(decide(bad as never, nothing), { deny: false });
    }
  });
});

/**
 * The case a fragment-only check cannot see: six edits, none of them over the floor on its own,
 * leaving a file that `comment-budget.mjs` then names in CI.
 */
describe("the file the edit will leave behind", () => {
  const code = (n: number) => Array.from({ length: n }, (_, i) => `const x${i} = ${i};`);
  const prose = (n: number) => Array.from({ length: n }, (_, i) => `// line ${i} of prose`);

  test("the seventh comment line is denied even though no one edit added six", () => {
    const head = code(4).join("\n");
    const now = [...prose(6), ...code(4)].join("\n");
    const out = edit("// one more", "src/x.ts", tree(head, now));
    assert.equal(out.deny, true);
    assert.match(out.reason ?? "", /7 comment lines to 0 of code/);
  });

  test("the same seventh line passes on a file whose change also brought code", () => {
    const head = code(4).join("\n");
    const now = [...prose(6), ...code(40)].join("\n");
    assert.deepEqual(edit("// one more", "src/x.ts", tree(head, now)), { deny: false });
  });

  test("prose the file already had committed is not charged to this edit", () => {
    const held = [...prose(20), ...code(2)].join("\n");
    assert.deepEqual(edit("const y = 1;", "src/x.ts", tree(held, held)), { deny: false });
  });

  test("a file git does not have yet is judged against nothing, not skipped", () => {
    const now = [...prose(7), ...code(1)].join("\n");
    assert.equal(edit("// one more", "src/x.ts", tree("", now)).deny, true);
  });

  /**
   * Rewording an existing comment adds comment lines and no code. Denying that would stop a ticket
   * over an improvement, which is why the prose-only floor is CI's and not this hook's.
   */
  test("rewording a few lines of an existing comment is never denied", () => {
    const head = ["// the old wording", ...code(4)].join("\n");
    const now = [...code(4)].join("\n");
    assert.deepEqual(edit(prose(3).join("\n"), "src/x.ts", tree(head, now)), { deny: false });
  });

  test("a docblock that is most of what the change adds is denied", () => {
    const head = code(40).join("\n");
    const block = ["/**", ...Array.from({ length: 8 }, () => " * an invariant the types cannot carry."), " */"];
    assert.equal(edit(block.join("\n"), "src/x.ts", tree(head, head)).deny, true);
  });

  test("a file that cannot be read is left alone rather than guessed at", () => {
    const block = Array.from({ length: 20 }, () => "// prose").join("\n");
    assert.deepEqual(edit(block, "src/x.ts", { committed: () => "", disk: () => null }), { deny: false });
  });

  /**
   * The hook is handed an absolute path. A `committed` that cannot resolve one returns "", every
   * line of the file counts as added, and the next edit to anything with a header is denied — so
   * this reads a real committed file rather than a fixture.
   */
  test("an absolute path resolves to what git has, not to nothing", () => {
    const held = io.committed(fileURLToPath(new URL("../comment-budget.mjs", import.meta.url)));
    assert.match(held, /export function addedCounts/);
  });

  test("a path git has never heard of is empty rather than an error", () => {
    assert.equal(io.committed(fileURLToPath(new URL("../no-such-file.mjs", import.meta.url))), "");
  });

  test("the edit is applied as Edit applies it, so the ratio is the file's own", () => {
    const io = { committed: () => "const a = 1;", disk: () => "const a = 1;" };
    const out = decide(
      { tool_name: "Edit", tool_input: { file_path: "src/x.ts", old_string: "const a = 1;", new_string: prose(8).join("\n") } } as never,
      io,
    );
    assert.equal(out.deny, true, "replacing code with prose left no code behind");
  });
});
