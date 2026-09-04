/**
 * The pre-push check, run once per tree state.
 *
 * Runs `STEPS` below - the only list this script reads; `package.json`'s `verify` is a second
 * entry point that runs the same stages unconditionally, where `test:native` here is gated on
 * whether the change can reach it. Records the verdict against a hash of the working tree, so
 * called again on an unchanged tree it replays instead of re-running and a stage that checks
 * twice pays for it once. Any edit changes the hash and the suites run again.
 *
 * Usage: npm run agent:check          run, or replay a cached verdict
 *        npm run agent:check -- --force   ignore the cache
 */
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { nativeScope } from "./native-scope.mjs";

/**
 * Per step. A wedged jest or a suite waiting on a port nothing will bind used to hang this
 * check for ever, and an unattended run has nobody to notice - a check that never answers is
 * worse than one that answers red. On Windows the kill reaches the shell rather than the whole
 * tree, so a stray child can outlive it; the verdict is still delivered.
 */
const STEP_TIMEOUT_MS = 20 * 60_000;

const STEPS = [
  { name: "typecheck", args: ["run", "typecheck"] },
  { name: "typecheck:strict", args: ["run", "typecheck:strict"] },
  { name: "test", args: ["test"] },
  // Both jest projects, ios and android: they run the same files under
  // different setups, so one of the two passing is not an outcome.
  { name: "test:native", args: ["run", "test:native"], when: nativeScope },
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
const skipped = [];
for (const step of STEPS) {
  const scope = step.when?.();
  if (scope && !scope.run) {
    skipped.push(`${step.name} (${scope.reason})`);
    continue;
  }
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

// A green line standing for a suite nobody ran is the defect this check was
// reported for, so what it left out is part of its verdict.
const verdict = (outcome) =>
  skipped.length ? `${outcome}\n  not run: ${skipped.join(", ")}` : outcome;

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
