// tests/ticketPipelineWorktree.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildWorktreeCommands, worktreePathFor, WORKTREE_DIR } from "../lib/ticketPipeline/worktree.ts";
import { toPosixPath } from "../lib/ticketPipeline/cleanup.ts";

const request = { number: 42, branch: "agent/42-thing" };

describe("building the worktree setup command list", () => {
  test("the worktree is created nested, on the ticket's branch, from origin/main", () => {
    assert.equal(worktreePathFor(42), ".worktrees/agent-42");
    assert.ok(
      buildWorktreeCommands(request)[0] === "git worktree add -b 'agent/42-thing' '.worktrees/agent-42' origin/main"
    );
  });

  test("the resolve probe runs inside the worktree, after the cd", () => {
    const cmds = buildWorktreeCommands(request);
    const cd = cmds.findIndex((c) => c.startsWith("cd "));
    const probe = cmds.findIndex((c) => c.includes("require.resolve"));
    assert.ok(cd !== -1 && probe !== -1);
    assert.ok(cd < probe, "the probe has to run from inside the worktree it is checking");
  });

  // Nested, so Node's ancestor lookup finds the main checkout's install with nothing linked in.
  // A sibling path here is what made every script in the worktree die on its first import.
  test("the worktree is nested inside the checkout and links nothing in", () => {
    const cmds = buildWorktreeCommands(request);
    assert.ok(worktreePathFor(42).startsWith(`${WORKTREE_DIR}/`));
    assert.ok(!worktreePathFor(42).startsWith(".."), "a sibling worktree cannot see the install");
    assert.ok(!cmds.some((c) => c.includes("node_modules")), "nesting means nothing to link or unlink");
  });

  // Without this the claim stage reports a path to a checkout where every later stage dies on its
  // first import, and the run burns an implement agent before anyone notices.
  test("the path is only reported once the probe has passed", () => {
    const cmds = buildWorktreeCommands(request);
    assert.equal(cmds.at(-1), "pwd", "the last command has to print the path the caller reports");
    assert.ok(cmds.at(-2)?.includes("require.resolve"), "the path is only reported once the probe passes");
  });

  test("the reported path is POSIX, whatever form it arrives in", () => {
    assert.equal(toPosixPath("C:\\Users\\dev\\murlan-wt-42"), "/c/Users/dev/murlan-wt-42");
    assert.equal(toPosixPath("/c/Users/dev/murlan-wt-42"), "/c/Users/dev/murlan-wt-42");
    assert.equal(toPosixPath("../murlan-wt-42"), "../murlan-wt-42");
  });

  test("a branch name is quoted, so one carrying a shell character cannot split the command", () => {
    const cmds = buildWorktreeCommands({ number: 7, branch: "agent/7-a;rm -rf x" });
    assert.ok(cmds[0].includes("'agent/7-a;rm -rf x'"));
  });
});
