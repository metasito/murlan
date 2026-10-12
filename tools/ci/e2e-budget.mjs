// A Playwright reporter that warns on a CI shard when a spec file takes more than its budget (twice
// what `tests/e2e/timings.json` measured for it, plus `SLACK_S`), and fails it past `HARD_FACTOR` times that. It reads the
// committed file, never the working tree: CI overwrites that copy with the branch's own
// measurements before the suite starts, which would let a run raise its own budget. A green shard also
// writes the specs over budget to `out`, which ci.yml uploads for the loop's land gate (`overBudget` in
// tools/loop/ciVerdict.ts).

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");

/** @returns {Record<string, number>} */
export function committedTimings() {
  return JSON.parse(execFileSync("git", ["show", "HEAD:tests/e2e/timings.json"], { encoding: "utf8" }));
}

export const RATIO = 2;
export const SLACK_S = 30;
export const HARD_FACTOR = 3;

/**
 * @param {Record<string, number>} measured seconds this run spent per spec file
 * @param {Record<string, number>} recorded seconds `timings.json` holds per spec file
 * @returns {{ file: string, seconds: number, budget: number }[]} each file over its budget
 */
export function overBudget(measured, recorded) {
  return Object.entries(measured)
    .filter(([file]) => file in recorded)
    .map(([file, seconds]) => ({ file, seconds, budget: recorded[file] * RATIO + SLACK_S }))
    .filter(({ seconds, budget }) => seconds > budget);
}

export default class BudgetReporter {
  /** @type {Record<string, number>} */
  ms = {};
  /** @type {Map<string, number>} */
  slowestAttempt = new Map();
  /** @type {Set<string>} */
  skipped = new Set();
  testDir = "";

  /** @param {{ out?: string }} [options] */
  constructor(options) {
    this.out = options?.out ?? path.join(process.env.RUNNER_TEMP ?? tmpdir(), "over-budget.json");
  }

  printsToStdio() {
    return false;
  }

  /** @param {any} config */
  onBegin(config) {
    this.testDir = config.projects[0].testDir;
  }

  /** @param {any} test @param {any} result */
  onTestEnd(test, result) {
    let suite = test.parent;
    while (suite && suite.type !== "file") suite = suite.parent;
    const file = path.relative(this.testDir, suite?.location?.file ?? test.location.file).split(path.sep).join("/");
    if (result.status === "skipped") this.skipped.add(file);
    // The budget prices one run of the test, its slowest attempt.
    const prior = this.slowestAttempt.get(test.id) ?? 0;
    if (result.duration <= prior) return;
    this.slowestAttempt.set(test.id, result.duration);
    this.ms[file] = (this.ms[file] ?? 0) + result.duration - prior;
  }

  /** @param {any} result */
  onEnd(result) {
    if (!process.env.CI || result.status !== "passed") return;
    /** @type {Record<string, number>} */
    const measured = {};
    for (const [file, ms] of Object.entries(this.ms)) if (!this.skipped.has(file)) measured[file] = Math.round(ms / 100) / 10;
    const over = overBudget(measured, committedTimings());
    const fromRoot = (/** @type {string} */ file) => path.relative(repoRoot, path.join(this.testDir, file)).split(path.sep).join("/");
    writeFileSync(this.out, JSON.stringify(over.map((o) => ({ ...o, file: fromRoot(o.file) }))));
    for (const { file, seconds, budget } of over) {
      const level = seconds > budget * HARD_FACTOR ? "error" : "warning";
      process.stdout.write(
        `::${level}::${file} took ${seconds}s against a budget of ${budget}s (${RATIO}× its measured time in tests/e2e/timings.json + ${SLACK_S}s; red past ${HARD_FACTOR}×). ` +
          `Find what made it slower and make it fast again: a pull request that changes this spec cannot land over its budget, nor raise its time in timings.json past ${RATIO}× (tools/loop/ciVerdict.ts).\n`
      );
    }
    if (over.some(({ seconds, budget }) => seconds > budget * HARD_FACTOR)) return { status: "failed" };
  }
}
