// #292
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { importUnderShellGuard } from "./helpers/importShellGuard.ts";
import {
  classifyWorktree,
  parseWorktreeList,
  hasUncommittedChanges,
  isInvokedDirectly,
  listWorktreeDirNames,
  findOrphanedWorktreeDirs,
} from "../scripts/prune-worktrees.mjs";

function baseState(overrides = {}) {
  return {
    branch: "agent/1-x",
    hasUncommittedChanges: false,
    locked: false,
    branchOnRemote: true,
    branchOnLocal: true,
    mergedIntoMain: false,
    prState: null,
    ...overrides,
  };
}

describe("classifyWorktree's floor", () => {
  test("uncommitted changes win live over a merged branch and a merged PR", () => {
    const result = classifyWorktree(
      baseState({ hasUncommittedChanges: true, mergedIntoMain: true, prState: "MERGED" }),
    );
    assert.equal(result.status, "live");
    assert.match(result.reason, /uncommitted/);
  });

  test("uncommitted changes win live even on a branch gone from both remote and local", () => {
    const result = classifyWorktree(
      baseState({ hasUncommittedChanges: true, branchOnRemote: false, branchOnLocal: false }),
    );
    assert.equal(result.status, "live");
  });

  test("uncommitted changes win live even on a detached-HEAD worktree", () => {
    const result = classifyWorktree(baseState({ hasUncommittedChanges: true, branch: null }));
    assert.equal(result.status, "live");
  });

  test("a locked worktree stays live even when its directory has already vanished", () => {
    const result = classifyWorktree(baseState({ locked: true, directoryMissing: true }));
    assert.equal(result.status, "live");
    assert.match(result.reason, /locked/);
  });
});

describe("classifyWorktree's other classifications", () => {
  test("a branch merged into origin/main is merged", () => {
    const result = classifyWorktree(baseState({ mergedIntoMain: true }));
    assert.equal(result.status, "merged");
    assert.match(result.reason, /merged into origin\/main/);
  });

  test("a merged pull request is merged, even before origin/main's own merge-base sees it", () => {
    const result = classifyWorktree(baseState({ prState: "MERGED" }));
    assert.equal(result.status, "merged");
  });

  test("a closed (not merged) pull request is also merged - safe to remove, the work was rejected", () => {
    const result = classifyWorktree(baseState({ prState: "CLOSED" }));
    assert.equal(result.status, "merged");
    assert.match(result.reason, /closed/);
  });

  test("an open pull request is live even on a branch that would otherwise look gone", () => {
    const result = classifyWorktree(
      baseState({ prState: "OPEN", branchOnRemote: false, branchOnLocal: false }),
    );
    assert.equal(result.status, "live");
    assert.match(result.reason, /open pull request/);
  });

  test("a branch on neither remote nor local, with no PR, is gone", () => {
    const result = classifyWorktree(baseState({ branchOnRemote: false, branchOnLocal: false }));
    assert.equal(result.status, "gone");
  });

  test("a detached HEAD worktree with no dirt is gone - no branch to track", () => {
    const result = classifyWorktree(baseState({ branch: null }));
    assert.equal(result.status, "gone");
    assert.match(result.reason, /detached/);
  });

  test("a locked worktree stays live regardless of merge state", () => {
    const result = classifyWorktree(baseState({ locked: true, mergedIntoMain: true }));
    assert.equal(result.status, "live");
    assert.match(result.reason, /locked/);
  });

  test("an unmerged branch still present remotely, with no PR at all, is left live rather than guessed at", () => {
    const result = classifyWorktree(baseState());
    assert.equal(result.status, "live");
  });

  test("a vanished directory is gone, without needing merge or pull-request state", () => {
    const result = classifyWorktree(baseState({ directoryMissing: true }));
    assert.equal(result.status, "gone");
    assert.match(result.reason, /no longer exists/);
  });

  test("a vanished directory is gone even when it also reported uncommitted changes", () => {
    const result = classifyWorktree(baseState({ directoryMissing: true, hasUncommittedChanges: true }));
    assert.equal(result.status, "gone");
  });
});

describe("parseWorktreeList", () => {
  test("parses the primary, a branch worktree and a detached one from real porcelain output", () => {
    const porcelain = [
      "worktree C:/Users/roton/murlan",
      "HEAD 6b6543025ce7f3e5d81cd096b092028a7256d55d",
      "branch refs/heads/main",
      "",
      "worktree C:/Users/roton/murlan-wt-36",
      "HEAD def456",
      "branch refs/heads/agent/36-react-compiler-gamecontext",
      "",
      "worktree C:/Users/roton/AppData/Local/Temp/verify-a1e15c3",
      "HEAD 789abc",
      "detached",
      "",
    ].join("\n");

    const entries = parseWorktreeList(porcelain);

    assert.equal(entries.length, 3);
    assert.deepEqual(entries[0], { path: "C:/Users/roton/murlan", branch: "main", locked: false });
    assert.deepEqual(entries[1], {
      path: "C:/Users/roton/murlan-wt-36",
      branch: "agent/36-react-compiler-gamecontext",
      locked: false,
    });
    assert.deepEqual(entries[2], {
      path: "C:/Users/roton/AppData/Local/Temp/verify-a1e15c3",
      branch: null,
      locked: false,
    });
  });

  test("marks an entry locked without losing its branch", () => {
    const porcelain = ["worktree /a/b", "HEAD abc", "branch refs/heads/keep-me", "locked", ""].join("\n");
    const entries = parseWorktreeList(porcelain);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].locked, true);
    assert.equal(entries[0].branch, "keep-me");
  });
});

function git(cwd: string, args: string[], env?: Record<string, string>) {
  return execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, ...env } });
}

describe("hasUncommittedChanges against a real worktree", () => {
  test("an untracked file counts as uncommitted - the near-miss #292 was filed over", (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "prune-wt-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));

    const origin = path.join(root, "origin.git");
    const work = path.join(root, "work");
    const linked = path.join(root, "linked");
    const gitEnv = {
      GIT_AUTHOR_NAME: "test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "test",
      GIT_COMMITTER_EMAIL: "test@example.com",
    };

    git(root, ["init", "--bare", "-b", "main", origin]);
    git(root, ["clone", origin, work]);
    git(work, ["config", "commit.gpgsign", "false"]);
    fs.writeFileSync(path.join(work, "readme.txt"), "hello\n");
    git(work, ["add", "readme.txt"]);
    git(work, ["commit", "-m", "init"], gitEnv);
    git(work, ["push", "origin", "main"]);
    git(work, ["worktree", "add", "-b", "agent/probe", linked]);

    assert.equal(hasUncommittedChanges(linked), false);

    fs.writeFileSync(path.join(linked, "HANDOVER.md"), "the only copy of the diagnosis\n");

    assert.equal(hasUncommittedChanges(linked), true);

    const state = classifyWorktree({
      branch: "agent/probe",
      hasUncommittedChanges: hasUncommittedChanges(linked),
      locked: false,
      branchOnRemote: false,
      branchOnLocal: true,
      mergedIntoMain: true,
      prState: "MERGED",
    });
    assert.equal(state.status, "live", "an untracked file must keep the worktree live even when everything else says remove it");
  });

  test("a worktree whose directory has already vanished throws rather than reading as clean", () => {
    const missing = path.join(os.tmpdir(), "prune-wt-does-not-exist-" + Date.now());
    assert.throws(() => hasUncommittedChanges(missing));
  });
});

describe("listWorktreeDirNames", () => {
  test("returns an empty list when .worktrees does not exist at all", () => {
    const missing = path.join(os.tmpdir(), "prune-wt-no-dir-" + Date.now());
    assert.deepEqual(listWorktreeDirNames(missing), []);
  });

  test("lists only directories under it, not stray files", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "prune-wt-dirs-"));
    fs.mkdirSync(path.join(root, "agent-1"));
    fs.mkdirSync(path.join(root, "agent-2"));
    fs.writeFileSync(path.join(root, "stray-file.txt"), "not a worktree");

    const names = listWorktreeDirNames(root).sort();

    assert.deepEqual(names, ["agent-1", "agent-2"]);
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe("findOrphanedWorktreeDirs", () => {
  test("a directory with no registered path pointing at it is orphaned", () => {
    const result = findOrphanedWorktreeDirs(
      ["agent-377", "agent-12"],
      ["C:/Users/roton/murlan", "C:/Users/roton/murlan/.worktrees/agent-12"],
    );
    assert.deepEqual(result, ["agent-377"]);
  });

  test("a directory name present among the registered paths is not orphaned", () => {
    const result = findOrphanedWorktreeDirs(
      ["agent-12"],
      ["C:/Users/roton/murlan/.worktrees/agent-12"],
    );
    assert.deepEqual(result, []);
  });

  test("no directories under .worktrees/ means no orphans, regardless of what is registered", () => {
    const result = findOrphanedWorktreeDirs([], ["C:/Users/roton/murlan"]);
    assert.deepEqual(result, []);
  });

  test("a registered path with no matching directory name does not itself produce an orphan", () => {
    const result = findOrphanedWorktreeDirs(
      ["agent-12"],
      ["C:/Users/roton/murlan/.worktrees/agent-12", "C:/Users/roton/murlan/.worktrees/agent-99"],
    );
    assert.deepEqual(result, []);
  });

  test("case-only difference matches on Windows, and is orphaned everywhere else", () => {
    const result = findOrphanedWorktreeDirs(
      ["Agent-12"],
      ["C:/Users/roton/murlan/.worktrees/agent-12"],
    );
    assert.deepEqual(result, process.platform === "win32" ? [] : ["Agent-12"]);
  });
});

describe("isInvokedDirectly", () => {
  test("is true only when argv1 resolves to the module's own path", () => {
    const self = path.resolve("scripts/prune-worktrees.mjs");
    const moduleUrl = pathToFileURL(self).href;

    assert.equal(isInvokedDirectly(self, moduleUrl), true);
    assert.equal(isInvokedDirectly(path.resolve("scripts/other.mjs"), moduleUrl), false);
    assert.equal(isInvokedDirectly(undefined, moduleUrl), false);
  });

  test("importing the module (not running it) never shells out to git or gh", () => {
    const moduleUrl = pathToFileURL(path.resolve("scripts/prune-worktrees.mjs")).href;

    const { shelledOutTo } = importUnderShellGuard(moduleUrl);

    assert.equal(shelledOutTo, null, "importing the module must not shell out to git or gh");
  });
});
