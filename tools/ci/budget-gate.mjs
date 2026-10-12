/**
 * RULES.md 46's land gate: a pull request that adds or changes a test file which ran over its time
 * budget cannot land. ci.yml's `Timing budget` job runs it, and `CI gate` needs that job.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { isInvokedDirectly } from "../../scripts/lib/entry.mjs";
import { RATIO } from "./e2e-budget.mjs";

/** @typedef {{ file: string, seconds: number, budget: number }} OverBudget an entry of the list native-budget.mjs and e2e-budget.mjs write on a green run */
/** @typedef {{ filename: string, status: string, patch?: string }} PrFile */
/** @typedef {{ files: string[], lines: string[], exempt: string[] }} BudgetFinding */
/** @typedef {(args: string[], until: number) => string} GhExec */

const E2E_DIR = "tests/e2e/";
const TIMINGS = `${E2E_DIR}timings.json`;

/**
 * A recorded time raised past `RATIO` is the same slowdown, moved into the baseline the budget is
 * computed from. A spec with no recorded time has no budget for the reporter to list.
 * @param {OverBudget[]} listed
 * @param {PrFile[]} prFiles
 * @returns {BudgetFinding}
 */
export function budgetFinding(listed, prFiles) {
  const touched = new Set(prFiles.filter((f) => f.status !== "removed").map((f) => f.filename));
  /** @type {string[]} */
  const files = [];
  /** @type {string[]} */
  const lines = [];
  // A native file is listed once per project it ran under.
  /** @type {Map<string, OverBudget>} */
  const slowest = new Map();
  for (const o of listed) if (touched.has(o.file) && o.seconds > (slowest.get(o.file)?.seconds ?? -1)) slowest.set(o.file, o);
  for (const o of slowest.values()) {
    files.push(o.file);
    lines.push(`${o.file}: ${o.seconds}s against a budget of ${o.budget}s`);
  }
  const timings = prFiles.find((f) => f.filename === TIMINGS);
  if (timings) {
    if (typeof timings.patch !== "string") throw new Error(`GitHub sent no diff for ${TIMINGS}`);
    /** @type {Record<string, number>} */
    const was = {};
    /** @type {Record<string, number>} */
    const now = {};
    for (const m of timings.patch.matchAll(/^([+-])\s*"([^"]+)":\s*([\d.]+)/gm)) (m[1] === "-" ? was : now)[m[2]] = Number(m[3]);
    for (const [spec, to] of Object.entries(now)) {
      const file = E2E_DIR + spec;
      if (!touched.has(file) || !(spec in was) || to <= was[spec] * RATIO) continue;
      files.push(file);
      lines.push(`${file}: ${TIMINGS} raises its time from ${was[spec]}s to ${to}s, past ${RATIO}x`);
    }
  }
  const exempt = prFiles
    .filter((f) => f.status === "added" && f.filename.startsWith(E2E_DIR) && f.filename.endsWith(".spec.ts"))
    .map((f) => f.filename);
  return { files: [...new Set(files)], lines, exempt };
}

/** @param {BudgetFinding} finding */
export function budgetReport({ lines, exempt }) {
  return [
    "A test file this pull request adds or changes ran over its time budget, so it cannot land (RULES.md 46):",
    ...lines.map((l) => `  ${l}`),
    "Make it fast again: find what made it slow; split it, or shrink what it plays to what it asserts.",
    ...(exempt.length ? [`No recorded time, so no budget yet: ${exempt.join(", ")}`] : []),
  ].join("\n");
}

/**
 * @param {string} repo
 * @param {number} runId
 */
export const budgetListArgs = (repo, runId) => ["run", "download", String(runId), "--repo", repo, "--pattern", "over-budget-*"];

/**
 * The run's over-budget lists against the pull request's files. Throws when a list cannot be read:
 * ci.yml uploads one from every green shard that ran, so a missing one is not an empty one.
 * @param {string} repo
 * @param {number} prNumber
 * @param {number} runId
 * @param {GhExec} gh
 * @param {number} until
 * @returns {BudgetFinding}
 */
export function overBudget(repo, prNumber, runId, gh, until) {
  const prFiles = gh(["api", `repos/${repo}/pulls/${prNumber}/files?per_page=100`, "--paginate", "--jq", ".[] | {filename, status, patch}"], until)
    .split("\n")
    .filter(Boolean)
    .map((l) => /** @type {PrFile} */ (JSON.parse(l)));
  if (!prFiles.some((f) => f.status !== "removed" && f.filename.startsWith("tests/"))) return budgetFinding([], prFiles);
  // Every attempt's upload is listed, one name per attempt (run 38229501646). The endpoint lists the
  // newest first and `gh run download` keeps the first of each name, so the latest attempt's is read.
  const names = new Set(
    gh(
      ["api", `repos/${repo}/actions/runs/${runId}/artifacts?per_page=100`, "--paginate", "--jq", '.artifacts[] | select(.name | startswith("over-budget-")) | .name'],
      until
    )
      .split("\n")
      .filter(Boolean)
  );
  /** @type {OverBudget[]} */
  const listed = [];
  if (names.size > 0) {
    const dir = mkdtempSync(path.join(tmpdir(), "over-budget-"));
    try {
      gh([...budgetListArgs(repo, runId), "--dir", dir], until);
      const found = readdirSync(dir, { recursive: true, encoding: "utf8" }).filter((f) => path.basename(f) === "over-budget.json");
      if (found.length !== names.size) throw new Error(`${found.length} of ${names.size} over-budget lists arrived`);
      for (const f of found) listed.push(...JSON.parse(readFileSync(path.join(dir, f), "utf8")));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  return budgetFinding(listed, prFiles);
}

/** Storage answers a burst of downloads with `503 Egress is over the account limit` (run 37784854605). */
const RETRY_WAITS_S = [5, 10, 20];
const READ_DEADLINE_MS = 5 * 60_000;

/** @type {GhExec} */
const realGh = (args, until) =>
  execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024, timeout: Math.max(1_000, until - Date.now()) });

/**
 * The gate over the pull request and run `env` names: 0 to pass, 1 on a finding, and 1 when the
 * lists cannot be read, since a list that never arrived is not an empty one.
 * @param {Record<string, string | undefined>} env
 * @param {GhExec} gh
 * @param {(seconds: number) => Promise<void>} sleep
 * @param {(line: string) => void} log
 */
export async function run(env, gh = realGh, sleep = (s) => new Promise((r) => setTimeout(r, s * 1000)), log = console.log) {
  const repo = env.GITHUB_REPOSITORY ?? "";
  const [pr, runId] = [env.PR, env.GITHUB_RUN_ID].map(Number);
  if (!/^[^/\s]+\/[^/\s]+$/.test(repo) || !Number.isInteger(pr) || pr <= 0 || !Number.isInteger(runId) || runId <= 0) {
    log("GITHUB_REPOSITORY, PR and GITHUB_RUN_ID must name the pull request and its run.");
    return 1;
  }
  const until = Date.now() + READ_DEADLINE_MS;
  for (let attempt = 0; ; attempt++) {
    try {
      const found = overBudget(repo, pr, runId, gh, until);
      if (found.files.length) {
        log(budgetReport(found));
        return 1;
      }
      log(found.exempt.length ? `No recorded time, so no budget yet: ${found.exempt.join(", ")}` : "No test file this pull request touches ran over its budget.");
      return 0;
    } catch (err) {
      const why = String(/** @type {Error} */ (err)?.message ?? err).split("\n")[0];
      if (attempt >= RETRY_WAITS_S.length) {
        log(`The run's over-budget lists could not be read: ${why}`);
        return 1;
      }
      log(`Reading the over-budget lists failed (${why}); trying again in ${RETRY_WAITS_S[attempt]} s.`);
      await sleep(RETRY_WAITS_S[attempt]);
    }
  }
}

// Not a top-level await: ciVerdict.ts is `require`d, and require() refuses a module that has one.
if (isInvokedDirectly(process.argv[1], import.meta.url)) run(process.env).then((code) => (process.exitCode = code));
