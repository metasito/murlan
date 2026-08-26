/**
 * Removes worktrees an interrupted session left behind. The ticket pipeline
 * tears its own worktree down on landing; this is the recovery for the
 * sessions that were killed, crashed or context-cleared before reaching
 * that teardown, and for anything left by hand. See #292.
 *
 * Every worktree but the primary (always the first `git worktree list`
 * prints) and the one this script is running from is classified:
 *
 *   merged - its branch is merged into origin/main, or its pull request is
 *            closed or merged.
 *   gone   - its branch exists on neither the remote nor locally (a
 *            detached-HEAD worktree, with no branch to check, counts as
 *            gone too), or its directory has already vanished from disk -
 *            there is nothing left there to lose, so this skips the merge
 *            and pull-request checks entirely.
 *   live   - an open pull request, or anything uncommitted in the tree.
 *
 * Only `merged` and `gone` are removed. `live` is printed and left alone,
 * and so is a worktree with uncommitted changes, checked first and
 * unconditionally, regardless of what its branch or pull request say -
 * that is the floor: this script must never be the reason unpushed work is
 * lost.
 *
 * A separate, unconditional pass removes any `.worktrees/` directory
 * `git worktree list` has no registration for at all - `git worktree
 * remove` unregisters before it deletes, and on Windows the delete can lose
 * to a file handle a just-exited process still holds, leaving the
 * registration gone and the directory behind (#377). There is no branch or
 * pull request left to check for one of these, so unlike `merged`/`gone`
 * above, non-empty is not a reason to keep it.
 *
 * Usage: node scripts/prune-worktrees.mjs [--dry-run]
 *        npm run worktrees:prune -- --dry-run
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function isInvokedDirectly(argv1, moduleUrl) {
  return Boolean(argv1) && path.resolve(argv1) === fileURLToPath(moduleUrl);
}

/**
 * Parses `git worktree list --porcelain` into one entry per worktree, in
 * the order git printed them - the first is always the primary worktree,
 * never a linked one.
 * @param {string} porcelain
 * @returns {{ path: string, branch: string | null, locked: boolean }[]}
 */
export function parseWorktreeList(porcelain) {
  const entries = [];
  let current = null;
  for (const line of porcelain.split("\n")) {
    if (line.startsWith("worktree ")) {
      if (current) entries.push(current);
      current = { path: line.slice("worktree ".length).trim(), branch: null, locked: false };
    } else if (!current) {
      continue;
    } else if (line.startsWith("branch refs/heads/")) {
      current.branch = line.slice("branch refs/heads/".length).trim();
    } else if (line === "detached") {
      current.branch = null;
    } else if (line.startsWith("locked")) {
      current.locked = true;
    }
  }
  if (current) entries.push(current);
  return entries;
}

/**
 * @param {{
 *   branch: string | null,
 *   hasUncommittedChanges: boolean,
 *   locked: boolean,
 *   branchOnRemote: boolean,
 *   branchOnLocal: boolean,
 *   mergedIntoMain: boolean,
 *   prState: "OPEN" | "MERGED" | "CLOSED" | null,
 *   directoryMissing?: boolean,
 * }} state
 * @returns {{ status: "merged" | "gone" | "live", reason: string }}
 */
export function classifyWorktree(state) {
  const { branch, hasUncommittedChanges, locked, branchOnRemote, branchOnLocal, mergedIntoMain, prState, directoryMissing } = state;

  // The floor, checked before anything else can override it.
  if (locked) {
    return { status: "live", reason: "worktree is locked" };
  }
  // Nothing on disk to lose - safe to drop the registration without even
  // asking whether the branch merged or its pull request closed.
  if (directoryMissing) {
    return { status: "gone", reason: "worktree directory no longer exists on disk" };
  }
  if (hasUncommittedChanges) {
    return { status: "live", reason: "uncommitted changes in the tree" };
  }
  if (branch === null) {
    return { status: "gone", reason: "detached HEAD, no branch to track" };
  }
  if (prState === "OPEN") {
    return { status: "live", reason: "open pull request" };
  }
  if (mergedIntoMain) {
    return { status: "merged", reason: "branch is merged into origin/main" };
  }
  if (prState === "MERGED" || prState === "CLOSED") {
    return { status: "merged", reason: `pull request ${prState.toLowerCase()}` };
  }
  if (!branchOnRemote && !branchOnLocal) {
    return { status: "gone", reason: "branch exists on neither the remote nor locally" };
  }
  return { status: "live", reason: "unmerged, with no closed or open pull request found" };
}

/** Includes untracked files - the near-miss #292 was filed over. */
export function hasUncommittedChanges(worktreePath) {
  const out = execFileSync("git", ["-C", worktreePath, "status", "--porcelain"], { encoding: "utf8" });
  return out.trim().length > 0;
}

function branchOnRemote(branch) {
  const out = execFileSync("git", ["ls-remote", "--heads", "origin", branch], { encoding: "utf8" });
  return out.trim().length > 0;
}

function branchOnLocal(branch) {
  try {
    execFileSync("git", ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], {
      stdio: ["ignore", "ignore", "ignore"],
    });
    return true;
  } catch {
    return false;
  }
}

function mergedIntoMain(branch) {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", branch, "origin/main"], {
      stdio: ["ignore", "ignore", "ignore"],
    });
    return true;
  } catch {
    return false;
  }
}

function prState(branch) {
  const rows = JSON.parse(
    execFileSync(
      "gh",
      ["pr", "list", "--head", branch, "--state", "all", "--json", "state", "--limit", "1"],
      { encoding: "utf8" },
    ),
  );
  return rows[0]?.state ?? null;
}

/** Resolves one worktree entry's full state, skipping network calls once the floor already applies. */
function classifyEntry(entry) {
  if (entry.locked) {
    return classifyWorktree({
      branch: entry.branch,
      hasUncommittedChanges: false,
      locked: true,
      branchOnRemote: false,
      branchOnLocal: false,
      mergedIntoMain: false,
      prState: null,
    });
  }
  if (!fs.existsSync(entry.path)) {
    return classifyWorktree({
      branch: entry.branch,
      hasUncommittedChanges: false,
      locked: false,
      branchOnRemote: false,
      branchOnLocal: false,
      mergedIntoMain: false,
      prState: null,
      directoryMissing: true,
    });
  }
  const dirty = hasUncommittedChanges(entry.path);
  if (dirty || entry.branch === null) {
    return classifyWorktree({
      branch: entry.branch,
      hasUncommittedChanges: dirty,
      locked: false,
      branchOnRemote: false,
      branchOnLocal: false,
      mergedIntoMain: false,
      prState: null,
    });
  }
  return classifyWorktree({
    branch: entry.branch,
    hasUncommittedChanges: false,
    locked: false,
    branchOnRemote: branchOnRemote(entry.branch),
    branchOnLocal: branchOnLocal(entry.branch),
    mergedIntoMain: mergedIntoMain(entry.branch),
    prState: prState(entry.branch),
  });
}

function samePath(a, b) {
  const [ra, rb] = [path.resolve(a), path.resolve(b)];
  return process.platform === "win32" ? ra.toLowerCase() === rb.toLowerCase() : ra === rb;
}

/**
 * `.worktrees/` mirrors `lib/ticketPipeline/worktree.ts`'s `WORKTREE_DIR` - it is not imported
 * here because that module is TypeScript and this script runs under plain `node`.
 */
const WORKTREE_DIR = ".worktrees";

/** [] both when the directory is empty and when it does not exist at all. */
export function listWorktreeDirNames(worktreesDir) {
  try {
    return fs
      .readdirSync(worktreesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

/**
 * `.worktrees/` directory names `git worktree list` registers no path for - orphaned by
 * `git worktree remove` unregistering before it deletes, then losing the delete to a
 * lingering file handle (see the module comment at the top of this file).
 * @param {string[]} dirNames - directory names read from `.worktrees/`
 * @param {string[]} registeredPaths - every path `git worktree list` reported
 * @returns {string[]}
 */
export function findOrphanedWorktreeDirs(dirNames, registeredPaths) {
  const registeredNames = new Set(
    registeredPaths.map((p) => (process.platform === "win32" ? path.basename(p).toLowerCase() : path.basename(p))),
  );
  return dirNames.filter((name) => {
    const key = process.platform === "win32" ? name.toLowerCase() : name;
    return !registeredNames.has(key);
  });
}

const invokedDirectly = isInvokedDirectly(process.argv[1], import.meta.url);

if (invokedDirectly) {
  const dryRun = process.argv.includes("--dry-run");

  const porcelain = execFileSync("git", ["worktree", "list", "--porcelain"], { encoding: "utf8" });
  const entries = parseWorktreeList(porcelain);
  const primary = entries[0];
  const cwd = process.cwd();

  const candidates = entries
    .slice(1)
    .filter((e) => !samePath(e.path, cwd));

  console.log(`Primary: ${primary?.path ?? "(none found)"}`);

  let removed = 0;
  let kept = 0;

  if (candidates.length === 0) {
    console.log("No other worktree to classify (aside from the one this is running from).");
  } else {
    try {
      execFileSync("git", ["fetch", "origin", "main", "--quiet"], { stdio: "ignore" });
    } catch (err) {
      console.error(`git fetch origin main failed (${err.message}); merge checks may read stale.`);
    }

    for (const entry of candidates) {
      let result;
      try {
        result = classifyEntry(entry);
      } catch (err) {
        // A worktree this run cannot inspect - gh unauthenticated, the
        // network down, git in a state the checks above didn't anticipate -
        // is never removed on a guess. Same floor as uncommitted changes:
        // unreadable stays put.
        console.error(`SKIP\t${entry.path}\tcould not classify: ${err.message}`);
        kept++;
        continue;
      }
      console.log(`${result.status.toUpperCase()}\t${entry.path}\t${entry.branch ?? "(detached)"}\t${result.reason}`);

      if (result.status !== "merged" && result.status !== "gone") {
        kept++;
        continue;
      }
      if (dryRun) {
        console.log(`  (dry run - would remove ${entry.path})`);
        continue;
      }
      try {
        execFileSync("git", ["worktree", "remove", entry.path], { stdio: "inherit" });
        console.log(`  removed ${entry.path}`);
        removed++;
      } catch (err) {
        console.error(`  failed to remove ${entry.path}: ${err.message}`);
        kept++;
      }
    }
  }

  // A directory `git worktree list` has no registration for at all - never a `candidates`
  // entry, so it needs its own pass regardless of whether any were found above.
  const orphanNames = findOrphanedWorktreeDirs(
    listWorktreeDirNames(WORKTREE_DIR),
    entries.map((e) => e.path),
  );
  let orphansRemoved = 0;
  for (const name of orphanNames) {
    const dirPath = path.join(WORKTREE_DIR, name);
    console.log(`ORPHAN\t${dirPath}\tno registration in git worktree list`);
    if (dryRun) {
      console.log(`  (dry run - would remove ${dirPath})`);
      continue;
    }
    try {
      fs.rmSync(dirPath, { recursive: true, force: true });
      console.log(`  removed ${dirPath}`);
      orphansRemoved++;
    } catch (err) {
      console.error(`  failed to remove ${dirPath}: ${err.message}`);
      kept++;
    }
  }

  const total = candidates.length + orphanNames.length;
  const totalRemoved = removed + orphansRemoved;
  console.log(
    dryRun
      ? `Dry run: ${total - kept} of ${total} would be removed, ${kept} kept.`
      : `Removed ${totalRemoved} of ${total}; kept ${kept}.`,
  );
}
