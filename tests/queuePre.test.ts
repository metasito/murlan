// tests/queuePre.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { misnamedWorktrees, mainHealth } from "../scripts/queue-pre.mjs";

describe("misnamedWorktrees", () => {
  test("names a worktree that does not follow the convention", () => {
    const bad = misnamedWorktrees([".worktrees/agent-42", ".worktrees/fix-971", ".worktrees/agent-7"]);
    assert.deepEqual(bad, [".worktrees/fix-971"]);
  });

  test("reads the basename, whichever separator the path uses", () => {
    assert.deepEqual(misnamedWorktrees([".worktrees\\agent-42"]), []);
    assert.deepEqual(misnamedWorktrees(["C:/x/.worktrees/agent-983"]), []);
  });

  test("a trailing suffix is not an agent worktree", () => {
    assert.deepEqual(misnamedWorktrees([".worktrees/agent-42-old"]), [".worktrees/agent-42-old"]);
  });
});

describe("mainHealth", () => {
  const run = (conclusion: string | null) => () => ({
    status: 0,
    stdout: JSON.stringify([{ conclusion, headSha: "abcdef1234", url: "https://x/1" }]),
  });

  test("says nothing when main is green", () => {
    const said: string[] = [];
    mainHealth(run("success") as never, (m: string) => said.push(m));
    assert.deepEqual(said, []);
  });

  test("names a red main, and does not refuse the ticket", () => {
    const said: string[] = [];
    const blocked = mainHealth(run("failure") as never, (m: string) => said.push(m));
    assert.equal(blocked, undefined, "a red main is a warning, never a refusal");
    assert.match(said.join("\n"), /failure/);
    assert.match(said.join("\n"), /abcdef12/);
  });

  test("an unreachable tracker is silent rather than fatal", () => {
    const said: string[] = [];
    mainHealth((() => {
      throw new Error("gh: not logged in");
    }) as never, (m: string) => said.push(m));
    assert.deepEqual(said, []);
  });

  // A run still going has no conclusion yet, and that is not a red main.
  test("a run with no conclusion says nothing", () => {
    const said: string[] = [];
    mainHealth(run(null) as never, (m: string) => said.push(m));
    assert.deepEqual(said, []);
  });
});
