/**
 * The workspace a ticket starts in: the loop's own worktrees, the shared checkout and its install.
 * `queue-loop.mjs` calls `housekeeping` in-process before every pick, so a ticket's own context
 * never carries it.
 *
 * Usage: npm run queue:pre                                    housekeeping, by hand
 *        npm run worktrees:prune [-- --dry-run]               the sweep alone
 *        npm run worktrees:remove -- <path> [--force] [--dry-run]
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { isInvokedDirectly } from "../../scripts/lib/entry.mjs";
import { AGENT_DIR, REPO, WORKTREE_DIR, ticketOf } from "./loop-derive.mjs";
import { capabilities, note, stepRow, theme } from "./loop-render.mjs";
import { reap as reapSweep } from "./reap.mjs";

const gitAt = (cwd) => (args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const ghCli = (args, opts = {}) =>
  execFileSync("gh", args, { encoding: "utf8", maxBuffer: 1 << 24, stdio: ["ignore", "pipe", "pipe"], ...opts });
const firstLine = (err) => String(err?.stderr || err?.message || err).trim().split("\n")[0];

/**
 * Parses `git worktree list --porcelain` into one entry per worktree, in the order git printed
 * them - the first is always the primary worktree, never a linked one.
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
 * `git worktree remove` deletes the directory tree, and on Git for Windows before 2.54.0 it walks
 * **into** a junction rather than unlinking it: this repo's parallel-worktree convention junctions
 * `node_modules` at the real install, and one such remove emptied `node_modules/.bin` of all 177
 * shims before failing with "Invalid argument". From 2.54.0 it leaves the junction standing in the
 * unregistered directory instead. `rmdir` on a junction detaches it and leaves the target alone,
 * so doing that first is what makes the remove that follows safe and complete.
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
 * process still holds, leaving the registration gone and the directory behind (#377).
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

/** Includes untracked files - the near-miss #292 was filed over. */
const dirty = (git, worktreePath) => git(["-C", worktreePath, "status", "--porcelain"]).trim().length > 0;

const issueState = (ticket) => JSON.parse(ghCli(["issue", "view", String(ticket), "--json", "state"], { timeout: 30_000 })).state;

/** An open ticket's `refs/loop/wip/<n>` is parked work; only a closed one's is residue. */
export function dropWipRef(branch, { git = gitAt(process.cwd()), stateOf = issueState } = {}) {
  const ticket = ticketOf(branch);
  if (!ticket) return false;
  const ref = `refs/loop/wip/${ticket}`;
  try {
    git(["rev-parse", "--verify", "--quiet", ref]);
    if (stateOf(ticket) !== "CLOSED") return false;
    git(["update-ref", "-d", ref]);
    return true;
  } catch {
    return false;
  }
}

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
export function removeWorktree(target, { force = false, dryRun = false, git = gitAt(process.cwd()), stateOf = issueState } = {}) {
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
    dropWipRef(match.branch, { git, stateOf });
    return {
      removed: true,
      detached,
      why:
        `unregistered ${match.path}, but its directory could not be deleted — a process is ` +
        `holding it open, most often a shell whose working directory it is. The worktree is ` +
        `gone from git and the branch is free; the empty directory goes when that process exits.`,
    };
  }
  dropWipRef(match.branch, { git, stateOf });
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
  if (entry.branch === null) return { remove: "detached HEAD, no branch to keep" };
  const issue = JSON.parse(gh(["issue", "view", String(ticket), "--json", "state,labels"], { timeout: 30_000 }));
  if (issue.state === "CLOSED") return { remove: "its issue is closed", state: issue.state };
  if (issue.labels.some((l) => l.name === "in-progress")) return null;
  const [pr] = JSON.parse(gh(["pr", "list", "--head", entry.branch, "--state", "all", "--json", "state", "--limit", "1"], { timeout: 30_000 }));
  if (pr) return { remove: `its issue is no longer in-progress and its pull request is ${pr.state.toLowerCase()}`, state: issue.state };
  if (merged(git, entry.branch)) return { remove: "its issue is no longer in-progress and its branch is merged", state: issue.state };
  return { keep: "unmerged, no pull request found" };
}

/**
 * Removes the loop's leftover ticket worktrees under `.worktrees/agent-<n>` (`judgeWorktree` says
 * which). Never forced; the branch survives every removal, and `claim.mjs` rebuilds from it.
 *
 * Then removes the directories under `.worktrees/` git has no registration for (#377). There is
 * no branch or issue left to check for one of these, so non-empty is not a reason to keep it.
 *
 * @returns {Result}
 */
export function sweep({ pinned = /** @type {number|null} */ (null), dryRun = false, git = gitAt(process.cwd()), gh = ghCli } = {}) {
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
      const out = dryRun ? { removed: true } : removeWorktree(entry.path, { git, stateOf: () => verdict.state ?? "OPEN" });
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
      // and empty, so there is nothing here to rescue.
      if (["EPERM", "EBUSY", "ENOTEMPTY"].includes(err.code)) {
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
  const found = await reap({ say: (l) => said.push(l) });
  if (!found) return null;
  return { state: "done", detail: `took ${found}`, note: said.join("\n") };
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
  git = gitAt(process.cwd()),
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

/** Reads `root`'s own `package.json`/`package-lock.json`/`node_modules` and compares them. */
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
