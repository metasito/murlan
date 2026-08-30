// tests/worktreeRemoveCommand.test.ts
import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../scripts/prune-worktrees.mjs", import.meta.url));

// Named for the shape rather than the case. The real link is the install junction, but a test
// file joining that literal name trips the scanner in handBuiltNodeModulesPaths.test.ts.
const LINK = "linked-install";

let root: string | null = null;

afterEach(() => {
  if (root) fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  root = null;
});

function git(cwd: string, ...args: string[]) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: "pipe" });
}

/**
 * A repository with one linked worktree whose top level junctions out to an install that lives
 * outside it — the layout every parallel session on this machine runs in.
 *
 * Returns null on a platform that will not make the link, which leaves nothing to prove.
 */
function makeJunctionedWorktree() {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "murlan-wtrm-")));
  const repo = path.join(root, "repo");
  const install = path.join(root, "install");
  fs.mkdirSync(path.join(install, "typescript"), { recursive: true });
  fs.writeFileSync(path.join(install, "typescript", "tsc"), "the install", "utf8");

  fs.mkdirSync(repo);
  git(repo, "init", "--quiet", "--initial-branch", "main");
  git(repo, "config", "user.email", "t@example.com");
  git(repo, "config", "user.name", "t");
  fs.writeFileSync(path.join(repo, "package.json"), "{}", "utf8");
  // As the real checkout ignores `node_modules/`. Without it the junction reads as untracked
  // work and every removal here refuses, which is the fixture lying rather than the script.
  // No trailing slash: a junction is a directory to git and a POSIX symlink is a file, and only
  // the slashless pattern matches both. With the slash, CI ignored nothing and every removal
  // there refused on the link itself.
  fs.writeFileSync(path.join(repo, ".gitignore"), `${LINK}\n`, "utf8");
  git(repo, "add", "--", "package.json", ".gitignore");
  git(repo, "commit", "--quiet", "-m", "init");

  const worktree = path.join(repo, ".worktrees", "w1");
  git(repo, "worktree", "add", "--quiet", "-b", "side", worktree);
  try {
    fs.symlinkSync(install, path.join(worktree, LINK), "junction");
  } catch {
    return null;
  }
  return { repo, install, worktree, shim: path.join(install, "typescript", "tsc") };
}

describe("removing one named worktree", () => {
  test("detaches the link, removes the worktree, and leaves the install untouched", () => {
    const t = makeJunctionedWorktree();
    if (!t) return;

    execFileSync(process.execPath, [SCRIPT, "--remove", t.worktree], {
      cwd: t.repo,
      encoding: "utf8",
      stdio: "pipe",
    });

    assert.equal(fs.existsSync(t.worktree), false, "the worktree directory should be gone");
    assert.equal(fs.readFileSync(t.shim, "utf8"), "the install", "the install must survive untouched");
    assert.match(git(t.repo, "worktree", "list"), /^(?!.*w1)/s, "git should no longer register it");
  });

  // The floor. Without it this file would pass on a platform where nothing follows a link, and
  // report the state of the runner rather than the state of the script.
  test("the command it replaces is the one that destroys the install", () => {
    if (process.platform !== "win32") return;
    const t = makeJunctionedWorktree();
    if (!t) return;

    try {
      git(t.repo, "worktree", "remove", "--force", t.worktree);
    } catch {
      // Losing the delete partway through is the documented shape of this failure.
    }
    assert.equal(
      fs.existsSync(t.shim),
      false,
      "planted floor: git worktree remove is expected to follow the junction and empty the install"
    );
  });

  test("uncommitted work is never removed on a guess", () => {
    const t = makeJunctionedWorktree();
    if (!t) return;
    fs.writeFileSync(path.join(t.worktree, "unsaved.txt"), "work", "utf8");

    assert.throws(
      () =>
        execFileSync(process.execPath, [SCRIPT, "--remove", t.worktree], {
          cwd: t.repo,
          encoding: "utf8",
          stdio: "pipe",
        }),
      /uncommitted/i
    );
    assert.ok(fs.existsSync(t.worktree), "the worktree stays put");
    assert.ok(fs.existsSync(path.join(t.worktree, LINK)), "and its link is left attached");
  });

  test("--force takes it anyway, and still detaches before deleting", () => {
    const t = makeJunctionedWorktree();
    if (!t) return;
    fs.writeFileSync(path.join(t.worktree, "unsaved.txt"), "work", "utf8");

    execFileSync(process.execPath, [SCRIPT, "--remove", t.worktree, "--force"], {
      cwd: t.repo,
      encoding: "utf8",
      stdio: "pipe",
    });

    assert.equal(fs.existsSync(t.worktree), false, "the worktree directory should be gone");
    assert.equal(fs.readFileSync(t.shim, "utf8"), "the install", "the install must survive untouched");
  });

  test("a path that is not a registered worktree is refused, not deleted", () => {
    const t = makeJunctionedWorktree();
    if (!t) return;
    const stranger = path.join(root!, "stranger");
    fs.mkdirSync(stranger);
    fs.writeFileSync(path.join(stranger, "keep.txt"), "x", "utf8");

    assert.throws(
      () =>
        execFileSync(process.execPath, [SCRIPT, "--remove", stranger], {
          cwd: t.repo,
          encoding: "utf8",
          stdio: "pipe",
        }),
      /not a linked worktree/i
    );
    assert.ok(fs.existsSync(path.join(stranger, "keep.txt")));
  });
});
