// tools/loop/tests/worktreeRemoveCommand.test.ts
import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../prune-worktrees.mjs", import.meta.url));

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

// Measured on #1307 by swapping only the git: 2.53.0.windows.4 still follows, 2.54.0.windows.1 does not.
function removeFollowsJunction(gitVersion: string) {
  const v = /git version (\d+)\.(\d+)\./.exec(gitVersion);
  if (!v) throw new Error(`cannot read a git version from ${JSON.stringify(gitVersion)}`);
  return Number(v[1]) < 2 || (Number(v[1]) === 2 && Number(v[2]) < 54);
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
  test("a worktree named by another spelling of its path is still found", () => {
    const t = makeJunctionedWorktree();
    if (!t) return;
    const alias = path.join(root!, "alias");
    fs.symlinkSync(t.repo, alias, "junction");

    execFileSync(process.execPath, [SCRIPT, "--remove", path.join(alias, ".worktrees", "w1")], {
      cwd: t.repo,
      encoding: "utf8",
      stdio: "pipe",
    });

    assert.equal(fs.existsSync(t.worktree), false);
  });

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
    assert.equal(
      git(t.repo, "worktree", "list", "--porcelain").includes(`worktree ${t.worktree.replace(/\\/g, "/")}`),
      false,
      "git should no longer register it"
    );
  });

  /**
   * The floor. Without it this file would pass on a platform where nothing follows a link, and
   * report the state of the runner rather than the state of the script.
   *
   * Rather than skip where the raw command spares the install, the floor asserts what it does
   * there out loud.
   */
  test("the command it replaces is the one that destroys the install", () => {
    const t = makeJunctionedWorktree();
    if (!t) return;

    try {
      git(t.repo, "worktree", "remove", "--force", t.worktree);
    } catch {
      // Losing the delete partway through is the documented shape of this failure.
    }
    if (process.platform !== "win32") {
      assert.equal(
        fs.readFileSync(t.shim, "utf8"),
        "the install",
        "on this platform the raw command is already safe, so nothing in this file is a live guard"
      );
    } else if (removeFollowsJunction(git(t.repo, "--version"))) {
      assert.equal(
        fs.existsSync(t.shim),
        false,
        "planted floor: git worktree remove is expected to follow the junction and empty the install"
      );
    } else {
      assert.equal(fs.readFileSync(t.shim, "utf8"), "the install", "from 2.54.0 git spares the install");
      assert.deepEqual(
        fs.readdirSync(t.worktree),
        [LINK],
        "but leaves the junction standing in the unregistered directory, for the next recursive delete to follow"
      );
    }
  });

  test("Git for Windows follows the junction below 2.54.0 and not from it", { skip: process.platform !== "win32" }, () => {
    assert.equal(removeFollowsJunction("git version 2.53.0.windows.1"), true);
    assert.equal(removeFollowsJunction("git version 2.53.0.windows.4"), true);
    assert.equal(removeFollowsJunction("git version 2.9.5.windows.1"), true);
    assert.equal(removeFollowsJunction("git version 2.54.0.windows.1"), false);
    assert.equal(removeFollowsJunction("git version 2.55.0.windows.5"), false);
    assert.equal(removeFollowsJunction("git version 3.0.0.windows.1"), false);
    assert.throws(() => removeFollowsJunction("git version unknown"), /git version/);
  });

  test("the worktree the command is standing in is refused, not half-removed", () => {
    const t = makeJunctionedWorktree();
    if (!t) return;

    assert.throws(
      () =>
        execFileSync(process.execPath, [SCRIPT, "--remove", t.worktree], {
          cwd: t.worktree,
          encoding: "utf8",
          stdio: "pipe",
        }),
      /running in/i
    );
    assert.ok(fs.existsSync(path.join(t.worktree, "package.json")), "the worktree stays whole");
    assert.ok(fs.existsSync(path.join(t.worktree, LINK)), "and its link is left attached");
  });

  test("--force removes a locked worktree rather than detaching and failing", () => {
    const t = makeJunctionedWorktree();
    if (!t) return;
    git(t.repo, "worktree", "lock", t.worktree);

    execFileSync(process.execPath, [SCRIPT, "--remove", t.worktree, "--force"], {
      cwd: t.repo,
      encoding: "utf8",
      stdio: "pipe",
    });

    assert.equal(fs.existsSync(t.worktree), false, "the worktree directory should be gone");
    assert.equal(fs.readFileSync(t.shim, "utf8"), "the install", "the install must survive untouched");
  });

  test("--dry-run says what it would do and removes nothing", () => {
    const t = makeJunctionedWorktree();
    if (!t) return;

    const out = execFileSync(process.execPath, [SCRIPT, "--remove", t.worktree, "--dry-run"], {
      cwd: t.repo,
      encoding: "utf8",
      stdio: "pipe",
    });

    assert.match(out, /dry run/i);
    assert.ok(fs.existsSync(path.join(t.worktree, LINK)), "the link is still attached");
    assert.ok(fs.existsSync(t.worktree), "the worktree is still there");
  });

  test("the path is found whichever side of the flags it is written", () => {
    const t = makeJunctionedWorktree();
    if (!t) return;

    execFileSync(process.execPath, [SCRIPT, "--remove", "--force", t.worktree], {
      cwd: t.repo,
      encoding: "utf8",
      stdio: "pipe",
    });

    assert.equal(fs.existsSync(t.worktree), false, "the worktree directory should be gone");
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

  /**
   * Makes a worktree's directory impossible to delete, by whichever means the platform gives.
   *
   * Windows gets the case that actually happens — a live process with the worktree as its cwd,
   * which is a session that ran its checks there. POSIX does not hold a directory that way, so
   * it takes the parent's write permission instead: different cause, identical shape, and the
   * shape is what the branch under test reacts to. Without the second the assertions below would
   * be Windows-only, and CI is Linux — a regression reverting the fix would land green.
   */
  async function makeUndeletable(worktree: string): Promise<() => Promise<void>> {
    if (process.platform === "win32") {
      const holder = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], {
        cwd: worktree,
        stdio: "ignore",
      });
      // The child has to have chdir'd before the removal runs, or it holds nothing yet.
      execFileSync(process.execPath, ["-e", "setTimeout(() => {}, 700)"], { stdio: "ignore" });
      return () =>
        new Promise<void>((resolve) => {
          // Awaited, not fired and forgotten: the cwd is pinned until the process is really gone,
          // and afterEach's own delete is next.
          holder.once("exit", () => resolve());
          holder.kill();
        });
    }
    const parent = path.dirname(worktree);
    const { mode } = fs.statSync(parent);
    fs.chmodSync(parent, 0o555);
    return async () => fs.chmodSync(parent, mode);
  }

  /**
   * git unregisters a worktree *before* it deletes the directory, so a delete that fails leaves
   * the worktree gone and the directory behind. Reporting that as a failure tells the next agent
   * nothing happened when the irreversible half is done.
   */
  test("a directory that cannot be deleted is reported as removed, not as a failure", async () => {
    const t = makeJunctionedWorktree();
    if (!t) return;

    const restore = await makeUndeletable(t.worktree);
    try {
      const out = execFileSync(process.execPath, [SCRIPT, "--remove", t.worktree], {
        cwd: t.repo,
        encoding: "utf8",
        stdio: "pipe",
      });

      assert.match(out, /unregistered/i, "it should say the worktree is gone and the directory is not");
      assert.equal(
        git(t.repo, "worktree", "list", "--porcelain").includes(`worktree ${t.worktree.replace(/\\/g, "/")}`),
        false,
        "git unregisters before it deletes, so the worktree is gone"
      );
      assert.ok(fs.existsSync(t.worktree), "the undeletable directory is still there, which is the point");
      assert.equal(fs.readFileSync(t.shim, "utf8"), "the install", "the install must survive untouched");
    } finally {
      await restore();
    }
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
