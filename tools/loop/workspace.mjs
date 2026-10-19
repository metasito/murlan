/**
 * The workspace a ticket starts in: the loop's own worktrees, the shared checkout and its install.
 * `queue-loop.mjs` calls `housekeeping` in-process before every pick, so a ticket's own context
 * never carries it.
 *
 * Usage: npm run queue:pre                                    housekeeping, by hand
 *        npm run worktrees:prune [-- --dry-run]               the sweep alone
 *        npm run worktrees:remove -- <path> [--force] [--dry-run]
 */
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { isInvokedDirectly } from "../../scripts/lib/entry.mjs";
import { firstLine, gh as ghCli, git as gitAt, MAX_BUFFER, REPO } from "./cli.mjs";
import { AGENT_DIR, derive, parityRed, WORKTREE_DIR } from "./loop-derive.mjs";
import { ciLogPath, errorLine, leftoverPath, parkNotePath, writeNote } from "./loop-logs.mjs";
import { PARK_FILE, parkAsked, ROOT, STOP_FILE } from "./paths.mjs";
import { REFRESH_TIMEOUT_MS } from "./limits.mjs";
import { capabilities, note, stepRow, theme } from "./loop-render.mjs";
import { reap as reapSweep } from "./reap.mjs";
import { ghTracker, PARK_STEPS } from "./tracker.mjs";

/**
 * In git's order: the first is always the primary worktree, never a linked one.
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
 * The names among these entries that are links rather than real directories. A Windows junction
 * reports as a symbolic link to Node, which is what makes this one test cover both.
 * @param {import("node:fs").Dirent[]} entries
 */
export function reparsePointNames(entries) {
  return entries.filter((e) => e.isSymbolicLink()).map((e) => e.name);
}

/**
 * Removes the links at a worktree's top level, and nothing they point at.
 *
 * `git worktree remove` on Git for Windows before 2.54.0 walks **into** a junction rather than
 * unlinking it, and this repo junctions `node_modules` at the real install; from 2.54.0 it leaves
 * the junction standing in the unregistered directory instead. `rmdir` on a junction detaches it
 * and leaves the target alone, so doing that first makes the remove that follows safe and complete.
 *
 * Failures are swallowed: a link that cannot be detached is a reason to let the caller's remove
 * fail on its own, not to abort the whole sweep.
 */
export function detachLinks(worktreePath) {
  let entries;
  try {
    entries = fs.readdirSync(worktreePath, { withFileTypes: true });
  } catch {
    return [];
  }
  const detached = [];
  for (const name of reparsePointNames(entries)) {
    const link = path.join(worktreePath, name);
    try {
      // A directory link needs `rmdir` and a file link needs `unlink`; neither follows the link.
      fs.rmdirSync(link);
      detached.push(name);
    } catch {
      try {
        fs.unlinkSync(link);
        detached.push(name);
      } catch {
        // Left in place; the caller's own remove will report why.
      }
    }
  }
  return detached;
}

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
 * `.worktrees/` directory names `git worktree list` registers no path for: `git worktree remove`
 * unregisters before it deletes, and on Windows the delete can lose to a file handle a just-exited
 * process still holds, leaving the registration gone and the directory behind.
 */
export function findOrphanedWorktreeDirs(dirNames, registeredPaths) {
  const key = (name) => (process.platform === "win32" ? name.toLowerCase() : name);
  const registered = new Set(registeredPaths.map((p) => key(path.basename(p))));
  return dirNames.filter((name) => !registered.has(key(name)));
}

/**
 * `derive()` reads a worktree's *branch* to find the ticket and ignores a directory whose branch
 * is not `agent/<n>-…`, so a `fix-971` is invisible to what decides whether a run is live.
 */
export function misnamedWorktrees(dirs) {
  return dirs.filter((d) => !AGENT_DIR.test(d.split(/[\\/]/).pop() ?? ""));
}

/** `native`, not the JS walk: only it expands a Windows 8.3 name like `RUNNER~1` into the long one git reports. */
function canonical(p) {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return path.resolve(p);
  }
}

const folded = (p) => (process.platform === "win32" ? canonical(p).toLowerCase() : canonical(p));
const samePath = (a, b) => folded(a) === folded(b);
const isAtOrUnder = (child, parent) => {
  const [c, p] = [folded(child), folded(parent)];
  return c === p || c.startsWith(p + path.sep);
};

/** Includes untracked files. */
const dirty = (git, worktreePath) => git(["-C", worktreePath, "status", "--porcelain"]).trim().length > 0;

/**
 * Removes one named worktree, links detached first, so that tearing a worktree down has a command
 * that cannot follow the install junction out of the tree.
 *
 * Refuses when the path is not a linked worktree of this repository, when the caller is standing
 * inside it, when it is locked, or when it holds work that is not committed. `force` waives the
 * last two and nothing else: the detaching is unconditional, because it protects a directory the
 * caller never named, and the cwd refusal is unconditional because a caller standing in the
 * worktree is the one process that will stop the directory being deleted.
 *
 * @returns {{ removed: boolean, why: string, detached?: string[] }}
 */
export function removeWorktree(target, { force = false, dryRun = false, git = /** @type {(args: string[]) => string} */ (gitAt(process.cwd())) } = {}) {
  const match = parseWorktreeList(git(["worktree", "list", "--porcelain"]))
    .slice(1)
    .find((entry) => samePath(entry.path, target));
  if (!match) return { removed: false, why: `${target} is not a linked worktree of this repository.` };
  if (isAtOrUnder(process.cwd(), match.path)) {
    return { removed: false, why: `${match.path} is the worktree this command is running in; run it from the main checkout.` };
  }
  if (!force && match.locked) return { removed: false, why: `${match.path} is locked; pass --force to remove it anyway.` };
  if (!force && fs.existsSync(match.path)) {
    let unsaved;
    try {
      unsaved = dirty(git, match.path);
    } catch (err) {
      return { removed: false, why: `${match.path} could not be read, so it is kept: ${firstLine(err)}` };
    }
    if (unsaved) return { removed: false, why: `${match.path} has uncommitted changes; commit them, or pass --force to remove it anyway.` };
  }
  if (dryRun) return { removed: false, would: true, why: `(dry run - would detach the links in ${match.path} and remove it)` };
  const detached = detachLinks(match.path);
  try {
    // Twice, deliberately: one `--force` does not override a lock, and stopping there would leave
    // a locked worktree whose links this call has already detached.
    git(["worktree", "remove", ...(force ? ["--force", "--force"] : []), match.path]);
  } catch (err) {
    // git unregisters before it deletes, so a failed delete leaves the worktree gone and the
    // directory behind. A `git worktree list` that itself fails counts as still registered, so the
    // caller keeps the error that actually describes what went wrong.
    let unregistered = false;
    try {
      unregistered = !parseWorktreeList(git(["worktree", "list", "--porcelain"]))
        .slice(1)
        .some((entry) => samePath(entry.path, match.path));
    } catch {
      unregistered = false;
    }
    if (!unregistered) return { removed: false, why: firstLine(err), detached };
    return {
      removed: true,
      detached,
      why:
        `unregistered ${match.path}, but its directory could not be deleted — a process is ` +
        `holding it open, most often a shell whose working directory it is. The worktree is ` +
        `gone from git and the branch is free; the empty directory goes when that process exits.`,
    };
  }
  return { removed: true, detached, why: `removed ${match.path}` };
}

/** The shared checkout every worktree hangs off — `git worktree list` always prints it first. */
function primaryOf(git) {
  const primary = parseWorktreeList(git(["worktree", "list", "--porcelain"]))[0]?.path;
  if (!primary) throw new Error("could not find the primary worktree");
  return primary;
}

/**
 * @typedef {null | { state: "done"|"warned"|"failed", detail?: string, note?: string }} Result
 *   what a step found, or `null` for nothing worth a row.
 */

const merged = (git, branch) => {
  try {
    git(["merge-base", "--is-ancestor", branch, "origin/main"]);
    return true;
  } catch {
    return false;
  }
};

/**
 * What the sweep does with one ticket worktree: `{remove}` or `{keep}` with the reason, or `null`
 * for a live run that says nothing. Decided before anything is touched, so a dry run says what the
 * real one would. A process may be standing in an unmerged tree nobody has a pull request for, so
 * that one is kept.
 */
function judgeWorktree(entry, ticket, { git, gh }) {
  if (entry.locked) return { keep: "locked" };
  if (dirty(git, entry.path)) return { keep: "uncommitted changes" };
  // A peer mid-rebase reads detached, and a commit reachable only from this HEAD goes with the
  // reflog: nothing here can tell which, so a person decides.
  if (entry.branch === null) return { keep: "detached HEAD — a rebase in progress or commits only it reaches; decide by hand" };
  const tracker = ghTracker(gh);
  const issue = tracker.issue(ticket, { timeout: 30_000 });
  if (issue.state === "CLOSED") return { remove: "its issue is closed" };
  if (issue.labels.includes("in-progress")) return null;
  const [pr] = tracker.prsFor({ branch: entry.branch }, { timeout: 30_000 });
  if (pr) return { remove: `its issue is no longer in-progress and its pull request is ${pr.state.toLowerCase()}` };
  if (merged(git, entry.branch)) return { remove: "its issue is no longer in-progress and its branch is merged" };
  return { keep: "unmerged, no pull request found" };
}

/**
 * Removes the loop's leftover ticket worktrees under `.worktrees/agent-<n>` (`judgeWorktree` says
 * which). Never forced; the branch survives every removal, and `claim.mjs` rebuilds from it.
 *
 * Then removes the directories under `.worktrees/` git has no registration for. There is
 * no branch or issue left to check for one of these, so non-empty is not a reason to keep it.
 *
 * @returns {Result}
 */
export function sweep({ pinned = /** @type {number|null} */ (null), dryRun = false, git = /** @type {(args: string[]) => string} */ (gitAt(process.cwd())), gh = ghCli } = {}) {
  git(["worktree", "prune"]);
  const entries = parseWorktreeList(git(["worktree", "list", "--porcelain"]));
  const dir = path.join(entries[0]?.path ?? process.cwd(), WORKTREE_DIR);
  const verb = dryRun ? "would remove" : "removed";
  const gone = [];
  const kept = [];
  const notes = [];
  const keep = (name, why) => {
    kept.push(name);
    notes.push(`${name}: kept — ${why}`);
  };
  for (const entry of entries.slice(1)) {
    const name = path.basename(entry.path);
    if (!AGENT_DIR.test(name) || !samePath(path.dirname(entry.path), dir)) continue;
    const ticket = Number(name.slice("agent-".length));
    if (ticket === pinned || isAtOrUnder(process.cwd(), entry.path)) continue;
    try {
      const verdict = judgeWorktree(entry, ticket, { git, gh });
      if (!verdict) continue;
      if (verdict.keep) {
        keep(name, verdict.keep);
        continue;
      }
      const out = dryRun ? { removed: true } : removeWorktree(entry.path, { git });
      if (!out.removed) {
        keep(name, out.why);
        continue;
      }
      gone.push(name);
      notes.push(`${name}: ${verb}, ${verdict.remove}`);
    } catch (err) {
      keep(name, firstLine(err));
    }
  }

  const registered = parseWorktreeList(git(["worktree", "list", "--porcelain"])).map((e) => e.path);
  for (const name of findOrphanedWorktreeDirs(listWorktreeDirNames(dir), registered)) {
    gone.push(name);
    if (dryRun) {
      notes.push(`${name}: would remove, git has no registration for it`);
      continue;
    }
    try {
      const orphan = path.join(dir, name);
      detachLinks(orphan);
      fs.rmSync(orphan, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      notes.push(`${name}: removed, git had no registration for it`);
    } catch (err) {
      // The ordinary reason one survives: a process is standing in it. It is already unregistered
      // and empty, so there is nothing here to rescue. ENOTEMPTY is not that: files are still in it.
      if (["EPERM", "EBUSY"].includes(err.code)) {
        notes.push(`${name}: unregistered, and held open by another process; it goes when that process exits`);
      } else {
        gone.pop();
        kept.push(name);
        notes.push(`${name}: could not be removed — ${err.message}`);
      }
    }
  }

  if (!gone.length && !kept.length) return null;
  return {
    state: kept.length ? "warned" : "done",
    detail: [gone.length ? `${verb} ${gone.join(", ")}` : "", kept.length ? `kept ${kept.join(", ")}` : ""].filter(Boolean).join(" · "),
    note: notes.join("\n"),
  };
}

/** Untracked files do not hold: a scratch file is not someone's in-flight change. */
function dirtyCheckout(git, primary) {
  const files = git(["-C", primary, "status", "--porcelain", "--untracked-files=no"]).trim();
  if (!files) return null;
  return {
    state: "failed",
    detail: "uncommitted changes in the shared checkout — not starting on top of them",
    note:
      `${files}\nThey belong to a session that did not finish. Commit them on a branch, or ask their owner ` +
      `to. Do not stash or discard them — that removes the work with nothing pointing at where it went.`,
  };
}

function installDrift(drift, primary) {
  const drifted = drift(primary);
  if (!drifted.length) return null;
  return {
    state: "failed",
    detail: "node_modules has drifted from package-lock.json",
    note:
      `${drifted.map((d) => `${d.name}: installed ${d.installed}, locked ${d.locked}`).join("\n")}\n` +
      `Run \`npm ci\` in ${primary} before trusting a local check. node_modules is shared live ` +
      `across every worktree: check no peer session is mid-run before reinstalling.`,
  };
}

/** `--stale` takes only what is orphaned *and* old, so the sweep cannot reach a peer's live run. */
async function reapRow(reap) {
  const said = [];
  const { took, blind } = await reap({ say: (l) => said.push(l) });
  if (blind) return { state: "warned", detail: blind, note: said.join("\n") };
  if (!took) return null;
  return { state: "done", detail: `took ${took}`, note: said.join("\n") };
}

function namedWorktrees(primary) {
  const bad = misnamedWorktrees(listWorktreeDirNames(path.join(primary, WORKTREE_DIR)));
  if (!bad.length) return null;
  return {
    state: "failed",
    detail: `${bad.length} not made by the loop — remove to start`,
    note: bad.map((n) => `${WORKTREE_DIR}/${n}\n  npm run worktrees:remove -- ${WORKTREE_DIR}/${n}`).join("\n"),
  };
}

/** A red `main` is a reason to file a ticket, never a reason to refuse one. */
function redMain(checkMain) {
  const health = checkMain();
  if (health?.state !== "filed") return null;
  return {
    state: "warned",
    detail: `red — ${health.why}`,
    note: `A ticket cut from here inherits it. Read the run before blaming the diff.\n${health.url ?? health.title}`,
  };
}

// Loaded on use: a static .ts import plus process.exit aborts node on Windows (nodejs/node#56645).
const mainHealth = (gh) => () => createRequire(import.meta.url)("./mainHealth.ts").checkMain({ repo: REPO, gh });

/**
 * Everything that has to be true before a ticket starts. `hold` is "not now, ask again": a peer's
 * uncommitted work and a drifted install both clear on their own. `stop` needs a person. A throw is
 * a stop with its own words, never a crash of the supervisor that called it.
 *
 * The order is load-bearing: the sweep runs before the naming check reads what is left, and a red
 * main is the last word, so a refusal is never buried under it.
 *
 * @returns {Promise<{ rows: object[], verdict: "ok"|"hold"|"stop", why?: string }>}
 */
export async function housekeeping({
  pinned = /** @type {number|null} */ (null),
  git = /** @type {(args: string[]) => string} */ (gitAt(process.cwd())),
  gh = ghCli,
  reap = (io) => reapSweep({ stale: true, ...io }),
  checkMain = mainHealth(gh),
  drift = checkLockDrift,
  say = () => {},
} = {}) {
  const rows = [];
  const step = async (label, run) => {
    const at = Date.now();
    const result = await run();
    if (!result) return null;
    const row = { label, ms: Date.now() - at, ...result };
    rows.push(row);
    say(row);
    return row;
  };
  try {
    await step("worktrees", () => sweep({ pinned, git, gh }));
    const primary = primaryOf(git);
    for (const [label, check] of [["checkout", () => dirtyCheckout(git, primary)], ["install", () => installDrift(drift, primary)]]) {
      const held = await step(label, check);
      if (held) return { rows, verdict: "hold", why: held.detail };
    }
    await step("reap", () => reapRow(reap));
    const misnamed = await step("worktrees", () => namedWorktrees(primary));
    if (misnamed) return { rows, verdict: "stop", why: `worktrees: ${misnamed.detail}` };
    await step("main", () => redMain(checkMain));
    return { rows, verdict: "ok" };
  } catch (err) {
    const why = String(err?.message ?? err);
    const row = { label: "housekeeping", state: "failed", detail: why.split("\n")[0], ms: null };
    rows.push(row);
    try {
      say(row);
    } catch {
      // The verdict is what the caller acts on; a row it could not draw changes nothing.
    }
    return { rows, verdict: "stop", why };
  }
}

/**
 * A dependency absent from the lockfile's `packages` map — a transitive-only entry, or a shape
 * this doesn't recognize — is not this function's call to make, so it is skipped rather than
 * guessed at. See `docs/agents/checks.md` for why this check exists.
 */
export function lockDrift(packageJson, packageLock, installedVersions) {
  const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
  const drift = [];
  for (const name of Object.keys(deps)) {
    const locked = packageLock.packages?.[`node_modules/${name}`]?.version;
    if (!locked) continue;
    const installed = installedVersions[name];
    if (installed !== locked) drift.push({ name, installed: installed ?? "missing", locked });
  }
  return drift;
}

/**
 * Deliberately not `require.resolve`: Node's resolver rejects a bare `${name}/package.json`
 * for any dependency whose own `exports` map omits it (helmet, drizzle-orm, ...), and has no
 * entry point at all to resolve for a types-only package (`@types/express`, ...) — both are
 * real dependencies of this repo, so that route drops real installs as "missing" rather than
 * reading them. See tests/tooling/handBuiltNodeModulesPaths.test.ts's IGNORE_LIST for this file.
 */
function installedVersion(root, name) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, "node_modules", name, "package.json"), "utf8")).version;
  } catch {
    return undefined;
  }
}

export function checkLockDrift(root) {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const packageLock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
  if (!packageLock.packages) {
    throw new Error(`${root}/package-lock.json has no "packages" map — cannot check for drift`);
  }
  const installed = Object.create(null);
  for (const name of Object.keys({ ...packageJson.dependencies, ...packageJson.devDependencies })) {
    installed[name] = installedVersion(root, name);
  }
  return lockDrift(packageJson, packageLock, installed);
}

// The session and the loop read these from the shared checkout, not from the ticket's worktree.
const PROTOCOL = ["CLAUDE.md", ".claude", "tools/loop", "scripts/lib"];

function peerWorktrees(dir = path.join(ROOT, WORKTREE_DIR)) {
  return listWorktreeDirNames(dir).filter((name) => name.startsWith("agent-"));
}

const mtime = (file) => (fs.existsSync(file) ? fs.statSync(file).mtimeMs : null);
const DRIFT_MARK = "node_modules/.loop-drift-reinstalled";

/**
 * npm's hidden lockfile, which every install writes after reading `package-lock.json`: a lockfile
 * newer than it is one no install has run against. The drift mark names the lockfile a drift
 * reinstall already ran for, so drift that `npm ci` cannot cure costs one install, not one a pass.
 */
export const stampAt = (root) => ({
  lockfile: () => mtime(path.join(root, "package-lock.json")),
  installed: () => mtime(path.join(root, "node_modules/.package-lock.json")),
  stored: () => (fs.existsSync(path.join(root, DRIFT_MARK)) ? fs.readFileSync(path.join(root, DRIFT_MARK), "utf8").trim() : null),
  write: (lock) => fs.writeFileSync(path.join(root, DRIFT_MARK), lock),
  peers: () => peerWorktrees(path.join(root, WORKTREE_DIR)),
  drifted: () => checkLockDrift(root).length > 0,
});

/** Captured, not inherited: npm's own report would draw over the board. A failure still carries it. */
export const reinstall = (run = sh, root = ROOT) => run("npm", ["ci", "--no-audit", "--no-fund"], { cwd: root });

/**
 * Leaves the shared checkout on an up-to-date `main`, or refuses and says why.
 *
 * It asks whether the protocol files are *dirty*, not whether they differ from `origin/main`.
 * Those are different questions: the loop's own tickets edit its own code, so the moment one
 * merges the checkout differs from origin until it is fast-forwarded — which is staleness,
 * repaired here rather than reported. Only an uncommitted edit is drift, and it belongs to someone.
 *
 * @param {{lockfile: () => number|null, installed: () => number|null, stored: () => string|null,
 *   write: (lock: string) => void, peers: () => string[], drifted: () => boolean}} [stamp]
 * @param {number|null} [pinned] the ticket whose own worktree, if any, is not another session
 */
export function syncCheckout(
  git,
  log,
  install = reinstall,
  { stamp = stampAt(ROOT), pinned = /** @type {number|null} */ (null) } = {},
) {
  const branch = git("rev-parse", "--abbrev-ref", "HEAD").trim();
  if (branch === "HEAD") {
    log("the shared checkout is on a detached HEAD — put it back on main first.");
    return false;
  }

  const dirty = git("status", "--porcelain", "--", ...PROTOCOL).trim();
  if (dirty) {
    // One call, not one per file: the caller renders a message as a row and its note, and a line at
    // a time gives each file a row of its own with nothing in the column that says what they are.
    log(
      `the protocol files here have uncommitted edits:\n${dirty}\n` +
        `Commit them, or put them somewhere else. Nothing here will discard them.`,
    );
    return false;
  }

  if (branch !== "main") {
    const own = Number(git("rev-list", "--count", "origin/main..HEAD").trim()) || 0;
    if (own > 0) {
      log(`${branch} is checked out with ${own} commit(s) of its own — not moving it.`);
      return false;
    }
    try {
      git("checkout", "main");
    } catch (err) {
      log(`cannot return to main — ${String(err.message).split("\n")[0]}`);
      return false;
    }
  }

  try {
    git("fetch", "origin", "--quiet");
    git("merge", "--ff-only", "origin/main");
  } catch (err) {
    log(`cannot fast-forward main — ${String(err.message).split("\n")[0]}`);
    return false;
  }

  // Keyed on what was installed, not the fast-forward's own diff: a diff seen once and skipped
  // for a live peer is gone for good, so a worktree standing at merge time must not cost the loop
  // its only chance to notice. `housekeeping` refuses to start a ticket on top of a drifted install,
  // so leaving the repair to the next iteration is the loop poisoning its own precondition. It
  // runs only when no *other* ticket's worktree is standing: every worktree's node_modules is a
  // junction into this install, so reinstalling under a live session empties the tree it is in.
  try {
    const lock = stamp.lockfile();
    const installed = stamp.installed();
    const changed = installed === null || lock > installed;
    if (lock !== null && (changed || (stamp.stored() !== String(lock) && stamp.drifted()))) {
      const what = changed ? "package-lock.json differs from the last install" : "node_modules has drifted from package-lock.json";
      const live = stamp.peers().filter((name) => name !== `agent-${pinned}`);
      if (live.length) {
        log(`${what}, but ${live.join(", ")} is live — not reinstalling`);
        return true;
      }
      log(`${what} — reinstalling before the next ticket`);
      install();
      if (!changed) stamp.write(String(lock));
    }
  } catch (err) {
    log(`could not reinstall — ${String(err.message).split("\n")[0]}`);
    return false;
  }
  return true;
}

// `npm` and `npx` are `.cmd` shims, and since the fix for CVE-2024-27980 node will not resolve one
// from execFileSync. Both are reached only with argument lists this file writes itself, never with
// anything a ticket or the tracker supplies.
const SHIMMED = new Set(["npm", "npx"]);

export const sh = (file, args, opts = {}) => {
  if (file === "git") return gitAt(opts.cwd)(args, opts);
  if (file === "gh") return ghCli(args, opts);
  const shell = SHIMMED.has(file) && process.platform === "win32";
  const base = { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: MAX_BUFFER, ...opts };
  // A command line, not a file plus arguments: under `shell` node concatenates them anyway, and
  // passing both is DEP0190. The quoting is this file's own, and one argument is a worktree path,
  // which carries whatever spaces the checkout's location has.
  if (shell) {
    const line = [file, ...args.map((a) => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a))].join(" ");
    return execFileSync(line, { ...base, shell: true });
  }
  return execFileSync(file, args, base);
};

/**
 * In-process, against the shared checkout: the supervisor runs from ROOT, which `removeWorktree`'s own
 * refusal of a caller standing inside the tree requires. A refusal throws, so a caller's step that
 * removed nothing reports as failed.
 *
 * @param {string} cwd
 * @param {{force?: boolean, git?: (args: string[]) => string}} [opts]
 */
export function tearDown(cwd, { force = false, git: run = gitAt(ROOT) } = {}) {
  const { removed, why } = removeWorktree(cwd, { force, git: (args) => run(args) });
  if (!removed) throw new Error(why);
  return why;
}

/**
 * Only after a confirmed merge. `force` is safe here because `removeWorktree` detaches the junction
 * before removing, and the leftovers are on disk first; a patch that cannot be written keeps the tree.
 */
export function removeLanded(cwd, number, { run = sh, write = writeNote, say = console.error, remove = tearDown, root = ROOT } = {}) {
  const branch = run("git", ["-C", cwd, "branch", "--show-current"]).trim();
  const removed = removeLandedTree(cwd, number, { run, write, say, remove, root });
  if (removed === null || !branch) return removed;
  try {
    run("git", ["branch", "-d", branch], { cwd: root });
  } catch (err) {
    say(`${branch} was kept — ${String(err.message).split("\n")[0]}`);
  }
  return removed;
}

function removeLandedTree(cwd, number, { run, write, say, remove, root }) {
  if (!run("git", ["-C", cwd, "status", "--porcelain"]).trim()) return remove(cwd);
  const file = path.join(root, leftoverPath(number));
  try {
    run("git", ["-C", cwd, "add", "-A"]);
    const patch = run("git", ["-C", cwd, "diff", "--cached", "--binary", "HEAD"], { encoding: "buffer" });
    write(file, patch);
  } catch (err) {
    say(`#${number}'s worktree has uncommitted leftovers and ${file} could not be written — ${String(err.message).split("\n")[0]}`);
    return null;
  }
  say(`#${number} landed with uncommitted leftovers in its worktree — saved to ${file}`);
  return remove(cwd, { force: true });
}


const git = (...args) => gitAt()(args);

/** The supervisor's own code moved under it: `syncCheckout` updated the checkout, not the running process. */
export function loopMoved(startSha, run = git) {
  if (!startSha) return null;
  try {
    run("diff", "--quiet", startSha, "HEAD", "--", "tools/loop", "scripts/lib");
    return null;
  } catch (err) {
    return err.status === 1 ? run("rev-parse", "--short", "HEAD").trim() : null;
  }
}

/** The commit this supervisor runs, or null: two loop versions are otherwise one in the record. */
export function loopSha(run = git) {
  try {
    return run("rev-parse", "HEAD").trim() || null;
  } catch {
    return null;
  }
}

/** A red round's `update-branch` moved the remote head, and the fix is built on top of it. */
export function refreshWorktree(cwd, branch, run = sh) {
  const opts = { timeout: REFRESH_TIMEOUT_MS };
  run("git", ["-C", cwd, "fetch", "--quiet", "origin", branch], opts);
  run("git", ["-C", cwd, "merge", "--ff-only", `origin/${branch}`], opts);
}

/** @param {() => ReturnType<typeof derive>} read */
const standingOf = (read) => {
  const s = read();
  return s.onTicket
    ? {
        ticket: s.ticket,
        head: s.head ?? null,
        commits: s.commits ?? 0,
        changed: s.changed ?? [],
        cwd: s.cwd,
        branch: s.branch,
        dirty: s.dirty,
        phase: s.phase,
        reviewRounds: s.reviewRounds ?? null,
      }
    : null;
};


/**
 * Hands a ticket back to the owner: the work committed, the claim released, the reason on the
 * issue, the worktree gone.
 *
 * Each step reports rather than throwing. This is the failure path — reached from the stop-file
 * drain as well as from a bad session — so a throw here would turn an orderly stop into an
 * unhandled rejection.
 *
 * @param {number} number
 * @param {{phase: string, why: string, log: string, cwd: string|null, branch: string|null,
 *   dirty: boolean, error?: object|null, run?: Function, tracker?: object, write?: Function, remove?: Function}} ctx
 * @returns {{ok: boolean, failed: string[]}}
 */
export function park(
  number,
  {
    phase,
    why,
    log,
    cwd,
    branch,
    dirty,
    error = null,
    run = sh,
    tracker = ghTracker((args, opts) => run("gh", args, opts)),
    write = writeNote,
    remove = (tree) => tearDown(tree, { git: (args) => run("git", args, { cwd: ROOT }) }),
  },
) {
  const failed = [];
  const step = (name, fn) => {
    try {
      fn();
    } catch (err) {
      failed.push(name);
      console.error(`  ⚠️ park #${number}: ${name} failed — ${String(err.message).split("\n")[0]}`);
    }
  };

  if (dirty && cwd) {
    // `-A` is safe here and nowhere else: this is the ticket's own worktree, which has its own
    // index, and rule 40 keeps every other session out of it. Losing an unstaged edit is the one
    // thing parking must not do. Re-read rather than trusting `dirty`: it comes from a derive()
    // up to twenty seconds old, and a session that committed in that window leaves nothing to
    // stage, which makes `git commit` exit 1.
    step("commit", () => {
      run("git", ["-C", cwd, "add", "-A", "--", "."]);
      if (run("git", ["-C", cwd, "status", "--porcelain"]).trim()) {
        run("git", ["-C", cwd, "commit", "-m", `wip(#${number}): parked in phase ${phase}`]);
      }
    });
  }

  step("label", () => PARK_STEPS.label(number, tracker));

  const body = [
    `Parked by the queue loop in **phase ${phase}**.`,
    "",
    `- reason: ${why}`,
    `- branch: \`${branch ?? "none"}\`${dirty ? " (uncommitted work was committed before teardown)" : ""}`,
    `- log: \`${log}\``,
    ...(error ? [`- error: ${errorLine(error)}`] : []),
    ...(error?.stderr ? ["", "```", error.stderr, "```"] : []),
    "",
    "The branch keeps its commits. Nothing was discarded.",
    "",
    "**To send it back:** deal with the reason above, then swap `ready-for-human` for `ready-for-agent`." +
      " The next run resumes from the branch as it stands.",
  ].join("\n");
  step("comment", () => {
    write(parkNotePath(number), body);
    PARK_STEPS.comment(number, tracker);
  });

  if (cwd) step("worktree", () => remove(cwd));

  return { ok: failed.length === 0, failed };
}

/**
 * The ticket's worktree as git has it now: a retry or refused pass carries none of it. `kept` is
 * the worktree directory left on disk, read only when `standing` itself cannot be.
 *
 * @param {() => {ticket: number, cwd: string, branch: string, dirty: boolean, phase?: string}|null} read
 * @param {number} number
 * @param {(number: number) => string|null} [kept]
 */
export function worktreeOf(read, number, kept = () => null) {
  try {
    const at = read();
    if (at?.ticket === number) return { cwd: at.cwd, branch: at.branch, dirty: at.dirty, phase: at.phase ?? null };
  } catch {
    const cwd = kept(number);
    if (cwd) return { cwd, branch: null, dirty: false, phase: null };
  }
  return { cwd: null, branch: null, dirty: false, phase: null };
}

/**
 * The workspace port: git and the disk under `root`, as `runOnce` and `main` reach them. What it
 * says goes through `events`.
 *
 * @param {{root?: string, git?: (args: string[]) => string, events: {log: Function, step: Function}}} opts
 */
export function workspacePort({ root = ROOT, git: run = gitAt(root), events }) {
  const at = (/** @type {string} */ file) => path.resolve(root, file);
  const g = (...args) => run(args);
  const started = loopSha(g);
  const standing = () => standingOf(() => derive({ cwd: root }));
  return {
    // Read, never removed: a scheduled restart must see the stop too.
    stopFile: () => fs.existsSync(at(STOP_FILE)),
    parkAsked: (n) => parkAsked(n, (f) => fs.readFileSync(at(f), "utf8")),
    clearParkAsk: () => fs.rmSync(at(PARK_FILE), { force: true }),
    ciLog: (n) => (fs.existsSync(at(ciLogPath(n))) ? ciLogPath(n) : null),
    worktreeOf: (n) => worktreeOf(standing, n, (k) => (fs.existsSync(at(`${WORKTREE_DIR}/agent-${k}`)) ? at(`${WORKTREE_DIR}/agent-${k}`) : null)),
    loopMoved: () => loopMoved(started, g),
    syncCheckout: (pinned) => syncCheckout(g, (m) => events.log(m, "checkout"), () => reinstall(sh, root), { pinned, stamp: stampAt(root) }),
    housekeeping: (pinned) => housekeeping({ pinned, say: events.step, git: run }),
    parity: () => parityRed(),
    standing,
    derive: () => derive({ cwd: root, ci: true }),
    refreshWorktree: (cwd, branch) => refreshWorktree(at(cwd), branch),
    sharedCheckoutDirty: () => g("status", "--porcelain").trim(),
    remove: (cwd, number) => {
      const dir = cwd && at(cwd);
      if (!dir || !fs.existsSync(dir)) return;
      try {
        removeLanded(dir, number, { root, say: (m) => events.log(m, "worktree"), remove: (tree, opts) => tearDown(tree, { ...opts, git: run }) });
      } catch {
        events.log(`${dir} is still standing — derive() will read it as a live run`, "worktree");
      }
    },
  };
}

function printRow({ note: words = "", ...row }) {
  const t = theme(capabilities(process.stderr));
  process.stderr.write(`${stepRow(row, t)}\n`);
  if (words.trim()) process.stderr.write(`${note(words, t)}\n`);
}

const CLI = {
  async check() {
    const { verdict } = await housekeeping({ say: printRow });
    return { ok: 0, hold: 2, stop: 1 }[verdict];
  },
  sweep(args) {
    const row = sweep({ dryRun: args.includes("--dry-run") });
    if (row) printRow({ label: "worktrees", ...row });
    else console.log("worktrees: nothing to sweep");
    return 0;
  },
  remove(args) {
    // The first non-flag argument, so `remove --force <path>` reads the same as `remove <path> --force`.
    const target = args.find((a) => !a.startsWith("--"));
    if (!target) {
      console.error("usage: npm run worktrees:remove -- <path> [--force] [--dry-run]");
      return 1;
    }
    const out = removeWorktree(target, { force: args.includes("--force"), dryRun: args.includes("--dry-run") });
    for (const name of out.detached ?? []) console.log(`detached ${name} (a link, not its target)`);
    const ok = out.removed || out.would === true;
    (ok ? console.log : console.error)(out.why);
    return ok ? 0 : 1;
  },
};

if (isInvokedDirectly(process.argv[1], import.meta.url)) {
  const [command, ...args] = process.argv.slice(2);
  if (!CLI[command]) {
    console.error("usage: node tools/loop/workspace.mjs check | sweep [--dry-run] | remove <path> [--force] [--dry-run]");
    process.exit(1);
  }
  process.exitCode = await CLI[command](args);
}
