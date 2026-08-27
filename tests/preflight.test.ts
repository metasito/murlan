// tests/preflight.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { classifyStatus, primaryWorktree } from "../scripts/preflight.mjs";

describe("what blocks a run from starting", () => {
  test("a modified tracked file blocks", () => {
    const { blocking } = classifyStatus(" M .claude/workflows/ticket-pipeline.mjs");
    assert.deepEqual(blocking, ["M .claude/workflows/ticket-pipeline.mjs"]);
  });

  test("staged, deleted and renamed files block too", () => {
    const { blocking } = classifyStatus("M  a.ts\n D b.ts\nR  c.ts -> d.ts");
    assert.equal(blocking.length, 3);
  });

  // A scratch folder is not someone's in-flight change, and a check that blocks on one becomes a
  // check people skip.
  test("untracked paths are reported but never block", () => {
    const { blocking, untracked } = classifyStatus('?? "murlan bug/"\n?? scratch.txt');
    assert.deepEqual(blocking, []);
    assert.deepEqual(untracked, ['"murlan bug/"', "scratch.txt"]);
  });

  // The floor: on a clean tree the check must find nothing. One that always reports something
  // would satisfy every assertion above and block every run.
  test("a clean tree blocks nothing and reports nothing", () => {
    const { blocking, untracked } = classifyStatus("");
    assert.deepEqual(blocking, []);
    assert.deepEqual(untracked, []);
  });

  test("the primary worktree is the first one git prints", () => {
    const listing = [
      "worktree C:/Users/dev/murlan",
      "HEAD abc",
      "branch refs/heads/main",
      "",
      "worktree C:/Users/dev/murlan/.worktrees/agent-42",
      "HEAD def",
    ].join("\n");
    assert.equal(primaryWorktree(listing), "C:/Users/dev/murlan");
  });

  test("an unreadable listing yields no worktree rather than a wrong one", () => {
    assert.equal(primaryWorktree(""), null);
  });
});
