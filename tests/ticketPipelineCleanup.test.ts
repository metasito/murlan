// tests/ticketPipelineCleanup.test.ts
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildCleanupCommands } from "../lib/ticketPipeline/cleanup.ts";

describe("building the cleanup command list", () => {
  test("a merged run with no worktree and no docker needs no teardown beyond the status check", () => {
    const cmds = buildCleanupCommands({ worktreePath: null, dockerStarted: false, localBranch: "agent/1-x", merged: true });
    assert.deepEqual(cmds, ["git status --short"]);
  });

  test("a run that started docker gets it removed by fixed name", () => {
    const cmds = buildCleanupCommands({ worktreePath: null, dockerStarted: true, localBranch: null, merged: true });
    assert.ok(cmds.includes("docker rm -f murlan-verify-pg"));
  });

  test("a run in a worktree gets it force-removed", () => {
    const cmds = buildCleanupCommands({ worktreePath: ".worktrees/agent-1", dockerStarted: false, localBranch: null, merged: true });
    assert.ok(cmds.includes("git worktree remove .worktrees/agent-1 --force"));
  });

  test("an abandoned (not merged) run guards the branch delete instead of issuing it bare", () => {
    const cmds = buildCleanupCommands({ worktreePath: null, dockerStarted: false, localBranch: "agent/2-y", merged: false });
    const guard = cmds.find((c) => c.includes("git branch -D"));
    assert.ok(guard, "expected a branch-delete command");
    assert.ok(!cmds.includes("git branch -D agent/2-y"), "the delete must not be issued unconditionally");
    assert.match(guard, /rev-list --count origin\/main\.\.'agent\/2-y'/);
  });

  test("a merged run does not delete the local branch (gh pr merge --delete-branch already handled it)", () => {
    const cmds = buildCleanupCommands({ worktreePath: null, dockerStarted: false, localBranch: "agent/3-z", merged: true });
    assert.ok(!cmds.some((c) => c.includes("git branch -D")));
  });

  test("a branch name is shell-quoted, so a metacharacter cannot reshape the command", () => {
    const cmds = buildCleanupCommands({ worktreePath: null, dockerStarted: false, localBranch: "agent/7; rm -rf .", merged: false });
    const guard = cmds.find((c) => c.includes("git branch -D"))!;
    assert.match(guard, /'agent\/7; rm -rf \.'/);
  });

  test("git status --short is always last", () => {
    const cmds = buildCleanupCommands({ worktreePath: ".worktrees/a", dockerStarted: true, localBranch: "agent/4-w", merged: false });
    assert.equal(cmds[cmds.length - 1], "git status --short");
  });
});

// The guard is a shell string, so asserting its text proves nothing about what it does. These run
// it against a real repository — including the null case where the comparison cannot run at all,
// which is the direction a check like this fails silently in.
describe("running the branch-delete guard", () => {
  let repo: string;

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "cleanup-guard-"));
    git("init", "-q", "-b", "main");
    git("config", "user.email", "t@t.t");
    git("config", "user.name", "t");
    git("commit", "-q", "--allow-empty", "-m", "base");
    git("update-ref", "refs/remotes/origin/main", "HEAD");
    git("branch", "no-work");
    git("branch", "holds-work");
    git("commit", "-q", "--allow-empty", "-m", "extra");
    git("branch", "-f", "holds-work", "HEAD");
    git("reset", "-q", "--hard", "HEAD~1");
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  function git(...args: string[]) {
    return execFileSync("git", args, { cwd: repo, encoding: "utf8" });
  }

  function runGuard(branch: string): string {
    const guard = buildCleanupCommands({
      worktreePath: null,
      dockerStarted: false,
      localBranch: branch,
      merged: false,
    }).find((c) => c.includes("git branch -D"))!;
    execFileSync("sh", ["-c", guard], { cwd: repo, encoding: "utf8" });
    return git("branch", "--list");
  }

  test("a branch holding commits origin/main does not have is kept", () => {
    const branches = runGuard("holds-work");
    assert.match(branches, /holds-work/);
  });

  test("a branch with nothing origin/main lacks is deleted", () => {
    const branches = runGuard("no-work");
    assert.ok(!/no-work/.test(branches), `expected no-work to be gone, got: ${branches}`);
  });

  test("a branch is kept when origin/main is missing, so a check that cannot run never deletes", () => {
    git("update-ref", "-d", "refs/remotes/origin/main");
    const branches = runGuard("no-work");
    assert.match(branches, /no-work/);
  });
});
