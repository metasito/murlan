/**
 * The pre-push check, run once per tree state.
 *
 * Runs typecheck, node tests and lint, then records the verdict against a hash of the working
 * tree. Called again on an unchanged tree it replays the verdict instead of re-running, so a
 * stage that checks twice pays for it once. Any edit changes the hash and the suites run again.
 *
 * Usage: npm run agent:check          run, or replay a cached verdict
 *        npm run agent:check -- --force   ignore the cache
 */
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const STEPS = [
  { name: "typecheck", args: ["run", "typecheck"] },
  { name: "typecheck:strict", args: ["run", "typecheck:strict"] },
  { name: "test", args: ["test"] },
  { name: "lint", args: ["run", "lint"] },
];

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

const force = process.argv.includes("--force");
const key = treeHash();
const cache = readCache();

if (!force && cache[key]?.pass) {
  console.log(`agent:check  CACHED PASS for tree ${key} (${cache[key].at})`);
  console.log("Nothing changed since that run. Use --force to run the suites anyway.");
  process.exit(0);
}

const failed = [];
for (const step of STEPS) {
  process.stdout.write(`\n=== ${step.name} ===\n`);
  const run = spawnSync("npm", step.args, { stdio: "inherit", shell: process.platform === "win32" });
  if (run.status !== 0) failed.push(step.name);
}

// Only a pass is cached. A failure has to re-run: the fix for it lands in the same tree the
// failure was recorded against only when nothing else moved, and replaying a red verdict would
// tell an agent its fix did not work.
cache[key] = { pass: failed.length === 0, at: new Date().toISOString(), failed };
fs.writeFileSync(cachePath(), JSON.stringify(cache, null, 2));

if (failed.length) {
  console.error(`\nagent:check  FAIL — ${failed.join(", ")}`);
  process.exit(1);
}
console.log(`\nagent:check  PASS  (tree ${key})`);
