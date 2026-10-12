/**
 * RULES.md 46's land gate: a pull request that adds or changes a test file which ran over its time
 * budget cannot land.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
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
