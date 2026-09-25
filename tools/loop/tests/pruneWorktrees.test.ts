// #292
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { importUnderShellGuard } from "../../../tests/helpers/importShellGuard.ts";
import { FOUND_NOTHING, IF_FOUND, WORKTREE_DIR } from "../loop-derive.mjs";
import {
  classifyEntry,
  classifyOrSkip,
  classifyWorktree,
  issueInProgress,
  ghLabels,
  parseWorktreeList,
  hasUncommittedChanges,
  listWorktreeDirNames,
  findOrphanedWorktreeDirs,
  newsCount,
  pruneCandidates,
  removable,
} from "../prune-worktrees.mjs";

function baseState(overrides = {}) {
  return {
    branch: "agent/1-x",
    hasUncommittedChanges: false,
    locked: false,
    branchOnLocal: true,
    mergedIntoMain: false,
    prState: null,
    issueInProgress: true,
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

  test("uncommitted changes win live even on an unborn branch", () => {
    const result = classifyWorktree(
      baseState({ hasUncommittedChanges: true, branchOnLocal: false }),
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
      baseState({ prState: "OPEN", branchOnLocal: false }),
    );
    assert.equal(result.status, "live");
    assert.match(result.reason, /open pull request/);
  });

  test("open PR but not in-progress → stale", () => {
    const result = classifyWorktree(baseState({ prState: "OPEN", issueInProgress: false }));
    assert.equal(result.status, "stale");
    assert.match(result.reason, /not in-progress/);
    assert.deepEqual(["merged", "gone", "stale", "live", "skip"].map(removable), [true, true, true, false, false]);
  });

  test("an unborn branch (no local ref), with no PR, is gone", () => {
    const result = classifyWorktree(baseState({ branchOnLocal: false }));
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

describe("classifyEntry's wiring", () => {
  const entry = { path: os.tmpdir(), branch: "agent/42-x", locked: false };
  const probe = (pr: string, inProgress: () => boolean, asked: string[] = []) => ({
    dirty: () => false,
    branchOnLocal: () => true,
    mergedIntoMain: () => false,
    prState: () => pr,
    issueInProgress: (branch: string) => {
      asked.push(branch);
      return inProgress();
    },
  });

  test("only an open pull request asks the issue", () => {
    const asked: string[] = [];
    assert.equal(classifyEntry(entry, probe("MERGED", () => false, asked)).status, "merged");
    assert.deepEqual(asked, []);
    assert.equal(classifyEntry(entry, probe("OPEN", () => false, asked)).status, "stale");
    assert.deepEqual(asked, ["agent/42-x"]);
  });

  test("an issue read that throws is a SKIP, and the tree is kept", () => {
    const out = classifyOrSkip(
      entry,
      probe("OPEN", () => {
        throw new Error("gh: HTTP 502");
      }),
    );
    assert.equal(out.status, "skip");
    assert.match(out.reason, /HTTP 502/);
    assert.equal(removable(out.status), false);
  });

  test("a ticket-less branch counts as in-progress without asking gh; labels split on CRLF", () => {
    const refuse = () => {
      throw new Error("gh must not be asked");
    };
    assert.equal(issueInProgress("feature/x", refuse), true);
    assert.equal(issueInProgress("agent/42-x", () => "bug\r\nin-progress\r\n"), true);
    assert.equal(issueInProgress("agent/42-x", () => "bug\r\n"), false);
  });

  test("the label read is bounded, so a wedged gh cannot hold the prune", () => {
    const seen: { file: string; args: string[]; timeout?: number }[] = [];
    const exec = (file: string, args: string[], opts: { timeout?: number }) => {
      seen.push({ file, args, timeout: opts.timeout });
      return "in-progress\n";
    };
    assert.equal(ghLabels(42, exec as never), "in-progress\n");
    assert.deepEqual(seen.map((s) => [s.file, s.args.slice(0, 3)]), [["gh", ["issue", "view", "42"]]]);
    assert.equal(seen[0].timeout, 30_000);
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
      branchOnLocal: true,
      mergedIntoMain: true,
      prState: "MERGED",
      issueInProgress: false,
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

describe("pruneCandidates", () => {
  const root = path.resolve("/repo");
  const e = (p: string, branch: string | null = null) => ({ path: p, branch, locked: false });
  const own = path.join(root, WORKTREE_DIR, "agent-12");
  const entries = [
    e(root, "main"),
    e(own, "agent/12-x"),
    e(path.join(root, ".claude", "worktrees", "foo"), "claude/foo"),
    e(path.join(root, ".claude", "worktrees", "bar")),
    e(path.resolve("/murlan-side-1206"), "side/1206-x"),
    e(path.join(root, WORKTREE_DIR, "agent-13"), "agent/13-y"),
  ];
  test("only the loop's own .worktrees/ entries, and never the caller's", () => {
    assert.deepEqual(pruneCandidates(entries, path.join(root, WORKTREE_DIR, "agent-13")).map((c: { path: string }) => c.path), [own]);
  });
  test("porcelain's forward slashes and another case still match on win32", { skip: process.platform !== "win32" }, () => {
    const porcelain = [e(root.replace(/\\/g, "/"), "main"), e(own.toUpperCase().replace(/\\/g, "/"), "agent/12-x")];
    assert.equal(pruneCandidates(porcelain, root).length, 1);
  });
});

describe("isInvokedDirectly", () => {
  test("importing the module (not running it) never shells out to git or gh", () => {
    const moduleUrl = new URL("../prune-worktrees.mjs", import.meta.url).href;

    const { shelledOutTo } = importUnderShellGuard(moduleUrl);

    assert.equal(shelledOutTo, null, "importing the module must not shell out to git or gh");
  });
});

describe("the --if-found answer", () => {
  const lonelyRepo = (t: { after: (fn: () => void) => void }) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prune-lonely-"));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    git(dir, ["init", "-b", "main"]);
    fs.writeFileSync(path.join(dir, "readme.txt"), "hello\n");
    git(dir, ["add", "-A"]);
    git(dir, ["commit", "-m", "init", "--no-gpg-sign"], {
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@t",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@t",
    });
    return dir;
  };
  const spawn = (dir: string, args: string[]) =>
    spawnSync(process.execPath, [fileURLToPath(new URL("../prune-worktrees.mjs", import.meta.url)), ...args], {
      cwd: dir,
      encoding: "utf8",
    });

  test("removing nothing is still exit 0 when nobody asked", (t) => {
    const done = spawn(lonelyRepo(t), []);
    assert.equal(done.status, 0, done.stderr);
    assert.match(done.stdout, /Removed 0 of 0/);
  });

  test("and answers FOUND_NOTHING when asked, so queue-pre can drop its row", (t) => {
    assert.equal(spawn(lonelyRepo(t), [IF_FOUND]).status, FOUND_NOTHING);
  });

  test("an orphan that will not come away still answers exit 0, through the CLI", (t) => {
    const dir = lonelyRepo(t);
    const orphan = path.join(dir, WORKTREE_DIR, "agent-999");
    fs.mkdirSync(orphan, { recursive: true });
    fs.writeFileSync(path.join(orphan, "held"), "x");
    // Block the delete the way a live process blocks it, on either platform and without a branch:
    // Windows refuses to remove any process's working directory, POSIX refuses to unlink out of a
    // directory it cannot write.
    const here = process.cwd();
    process.chdir(orphan);
    fs.chmodSync(orphan, 0o500);
    try {
      const done = spawn(dir, [IF_FOUND]);
      assert.match(done.stdout, /ORPHAN\t/, done.stdout);
      assert.equal(done.status, 0, done.stdout);
    } finally {
      process.chdir(here);
      fs.chmodSync(orphan, 0o700);
    }
  });

  test("an orphan held open by another process is still news", () => {
    // It reports on stdout and increments `kept`, so counting removals alone hid the one case the
    // row exists for.
    assert.equal(newsCount({ removed: 0, orphansFound: 1 }), 1);
  });

  test("a live worktree the run deliberately kept is not", () => {
    assert.equal(newsCount({ removed: 0, orphansFound: 0 }), 0);
  });

  test("a removal is news", () => {
    assert.equal(newsCount({ removed: 1, orphansFound: 0 }), 1);
  });
});
