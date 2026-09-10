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
import { primaryWorktree, checkLockDrift } from "./preflight.mjs";
import { LOCAL, DELEGATED, cmd } from "./check-steps.mjs";

/**
 * A wedged suite used to hang this check for ever, and an unattended run has nobody to notice.
 * On Windows the kill reaches the shell rather than the whole tree, so a stray child can outlive
 * it; the verdict is still delivered.
 */
const STEP_TIMEOUT_MS = 20 * 60_000;

// What this left out is part of its verdict, named as a command so nobody has to invent one.
const verdict = (outcome) =>
  [
    outcome,
    `  ran here:  ${LOCAL.map((s) => s.name).join(", ")}`,
    ...DELEGATED.map((s) => `  ci.yml ${s.job}:  ${cmd(s)}`),
  ].join("\n");

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
const key = treeHash();
const cache = readCache();

if (!force && cache[key]?.pass) {
  console.log(verdict(`agent:check  CACHED PASS for tree ${key} (${cache[key].at})`));
  console.log("Nothing changed since that run. Use --force to run the suites anyway.");
  process.exit(0);
}

const failed = [];
for (const step of LOCAL) {
  process.stdout.write(`\n=== ${step.name} ===\n`);
  const run = spawnSync("npm", step.args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    timeout: STEP_TIMEOUT_MS,
  });
  // A timeout leaves `status` null and sets `error.code` to ETIMEDOUT. Both are failures, but
  // only one of them says anything about the code, so they are reported apart.
  if (run.error?.code === "ETIMEDOUT") {
    console.error(`
${step.name} timed out after ${STEP_TIMEOUT_MS / 60_000} minutes`);
    failed.push(`${step.name} (timed out)`);
  } else if (run.status !== 0) {
    failed.push(step.name);
  }
}

// Only a pass is cached. A failure has to re-run: the fix for it lands in the same tree the
// failure was recorded against only when nothing else moved, and replaying a red verdict would
// tell an agent its fix did not work.
cache[key] = { pass: failed.length === 0, at: new Date().toISOString(), failed };
fs.writeFileSync(cachePath(), JSON.stringify(cache, null, 2));

if (failed.length) {
  console.error(verdict(`\nagent:check  FAIL — ${failed.join(", ")}`));
  process.exit(1);
}
console.log(verdict(`\nagent:check  PASS  (tree ${key})`));
