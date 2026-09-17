/**
 * The pre-push check, run once per tree state. The verdict is keyed on a hash of the working
 * tree, so an unchanged tree replays instead of re-running.
 *
 * Usage: npm run agent:check          run, or replay a cached verdict
 *        npm run agent:check -- --force   ignore the cache
 */
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { primaryWorktree, checkLockDrift, readSubject } from "./preflight.mjs";
import { STEPS, LOCAL, DELEGATED, byName, cmd, BANNER } from "./check-steps.mjs";
import { isInvokedDirectly } from "../../scripts/lib/entry.mjs";

/**
 * A wedged suite used to hang this check for ever, and an unattended run has nobody to notice.
 * On Windows the kill reaches the shell rather than the whole tree, so a stray child can outlive
 * it; the verdict is still delivered.
 */
const STEP_TIMEOUT_MS = 20 * 60_000;
const SHOWN_LINES = 40;
const HEAD_LINES = 10;

export const cacheEntry = ({ failed, head, clean }) => ({
  pass: failed.length === 0,
  at: new Date().toISOString(),
  failed,
  head,
  clean,
});

export const replays = (entry) => entry?.pass === true && typeof entry.head === "string";

/** What `loop-gate --build` asks: a LOCAL PASS judged on this head, from a tree with nothing uncommitted. */
export const cleanPassFor = (cache, head) =>
  Object.values(cache).find((e) => replays(e) && e.head === head && e.clean === true);

function clip(output) {
  const lines = output.split("\n");
  if (lines.length <= SHOWN_LINES) return `${output}\n`;
  const head = lines.slice(0, HEAD_LINES);
  const tail = lines.slice(HEAD_LINES - SHOWN_LINES);
  return [...head, `… ${lines.length - SHOWN_LINES} lines omitted …`, ...tail, ""].join("\n");
}

export function runStep(step, spawn = spawnSync, write = (s) => void process.stdout.write(s)) {
  write(`\n${BANNER}${step.name} ===\n▸ ${step.name} …\n`);
  const run = spawn("npm", step.args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32",
    timeout: STEP_TIMEOUT_MS,
    maxBuffer: 256 * 1024 * 1024,
  });
  // A timeout leaves `status` null and sets `error.code` to ETIMEDOUT. Both are failures, but
  // only one of them says anything about the code, so they are reported apart.
  const timedOut = run.error?.code === "ETIMEDOUT";
  if (!timedOut && run.status === 0) return { failed: null, text: "ok\n" };
  const shown = clip(`${run.stdout ?? ""}${run.stderr ?? ""}`.replace(/\n$/, ""));
  if (!timedOut) return { failed: step.name, text: shown };
  return {
    failed: `${step.name} (timed out)`,
    text: `${shown}${step.name} timed out after ${STEP_TIMEOUT_MS / 60_000} minutes\n`,
  };
}

let subject;
let extra = [];

// What this left out is part of its verdict, named as a command so nobody has to invent one, and
// which tree it read is the first of those: a verdict that does not say cannot be told from a
// vacuous one.
const verdict = (outcome) =>
  [
    outcome,
    `  judged:    ${subject.root} against origin/main@${subject.base}`,
    `  ran here:  ${ran().map((s) => s.name).join(", ")}`,
    `  NOT run:   ${skipped().length} suite(s) — a green line here stands for none of them`,
    ...skipped().map((s) => `  ci.yml ${s.job}:  ${cmd(s)}`),
  ].join("\n");

function ran() {
  return [...LOCAL, ...extra];
}
function skipped() {
  return DELEGATED.filter((s) => !extra.includes(s));
}

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

/**
 * Identifies the working tree by content, not by commit: HEAD alone would call an edited tree
 * unchanged, which is the one case that must never replay a stale pass.
 *
 * `write-tree` hashes tracked content including staged changes; unstaged and untracked files are
 * added by their own blob hashes. A file listed but unreadable hashes as its name plus the error,
 * so it still changes the key rather than silently dropping out of it.
 */
function treeHash() {
  const parts = [git("rev-parse", "HEAD").trim()];
  try {
    // Writing the index into the object store needs a temporary index, or a caller's staged state
    // would be rewritten by a read-only check.
    const tmpIndex = path.join(gitDir(), "agent-check-index");
    fs.copyFileSync(path.join(gitDir(), "index"), tmpIndex);
    parts.push(
      execFileSync("git", ["add", "-A", "--", "."], {
        env: { ...process.env, GIT_INDEX_FILE: tmpIndex },
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }) || "",
      execFileSync("git", ["write-tree"], {
        env: { ...process.env, GIT_INDEX_FILE: tmpIndex },
        encoding: "utf8",
      }).trim()
    );
    fs.rmSync(tmpIndex, { force: true });
  } catch (err) {
    parts.push(`unhashable:${err.message}`);
  }
  return createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 16);
}

function gitDir() {
  return git("rev-parse", "--absolute-git-dir").trim();
}

function cachePath() {
  return path.join(gitDir(), "agent-check-cache.json");
}

function readCache() {
  try {
    return JSON.parse(fs.readFileSync(cachePath(), "utf8"));
  } catch {
    return {};
  }
}

function main() {
  subject = readSubject(process.cwd());
  if (subject.refuse) {
    console.error(`agent:check: ${subject.refuse}`);
    process.exit(1);
  }
  // Everything below — the tree hash, the cache, the steps — reads the tree being judged rather than
  // wherever the invoker happened to be standing. Moving once is what keeps them from disagreeing.
  process.chdir(subject.root);

  // The cache key is tree content only (see `treeHash` above), so it cannot see a node_modules-only
  // drift — a peer session's `npm install` mid-run would otherwise keep replaying a stale PASS.
  const sharedRoot = primaryWorktree(git("worktree", "list", "--porcelain"));
  if (!sharedRoot) {
    console.error("agent:check: could not find the primary worktree");
    process.exit(1);
  }
  const drift = checkLockDrift(sharedRoot);
  if (drift.length) {
    console.error(`\nagent:check  node_modules in ${sharedRoot} has drifted from package-lock.json:\n`);
    for (const d of drift) console.error(`  ${d.name}: installed ${d.installed}, locked ${d.locked}`);
    console.error(
      `\nRun \`npm ci\` in ${sharedRoot} before trusting this result — node_modules is shared live ` +
        `across every worktree: check no peer session is mid-run before reinstalling.`
    );
    process.exit(1);
  }

  const force = process.argv.includes("--force");

  // A red CI round knows which suite failed, and running only that one here is the difference between
  // fixing it and pushing again to find out. Named, never a wildcard: `--also` picking up every
  // delegated step is `npm run verify` behind a memory preflight this machine refuses.
  const also = process.argv.indexOf("--also");
  extra = also >= 0 ? [byName(process.argv[also + 1])] : [];
  // Refused, not dropped: a mistyped suite that fell out of the list would print the same LOCAL PASS,
  // and the fix round would believe it had run the one CI named.
  if (extra.some((s) => !s)) {
    console.error(
      `agent:check  --also ${process.argv[also + 1] ?? ""} is not a step. One of: ` +
        STEPS.map((s) => s.name).join(", "),
    );
    process.exit(1);
  }

  // Keyed with them, so a `--also` run cannot replay as a plain one — or a plain one as a `--also`.
  const key = treeHash() + (extra.length ? `+${extra.map((s) => s.name).join(",")}` : "");
  const cache = readCache();

  if (!force && replays(cache[key])) {
    console.log(verdict(`agent:check  CACHED LOCAL PASS for tree ${key} (${cache[key].at})`));
    console.log("Nothing changed since that run. Use --force to run the suites anyway.");
    process.exit(0);
  }

  const head = git("rev-parse", "HEAD").trim();
  const clean = git("status", "--porcelain").trim() === "";
  const failed = [];
  for (const step of ran()) {
    const run = runStep(step);
    process.stdout.write(run.text);
    if (run.failed) failed.push(run.failed);
  }

  // Only a pass is cached. A failure has to re-run: the fix for it lands in the same tree the
  // failure was recorded against only when nothing else moved, and replaying a red verdict would
  // tell an agent its fix did not work.
  cache[key] = cacheEntry({ failed, head, clean });
  fs.writeFileSync(cachePath(), JSON.stringify(cache, null, 2));

  if (failed.length) {
    console.error(verdict(`\nagent:check  FAIL — ${failed.join(", ")}`));
    process.exit(1);
  }
  console.log(
    verdict(`\nagent:check  LOCAL PASS  (tree ${key}) — ${ran().length} of ${STEPS.length} suites`)
  );
}

if (isInvokedDirectly(process.argv[1], import.meta.url)) main();
