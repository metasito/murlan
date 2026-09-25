// A Playwright reporter that fails a CI shard when a spec file takes more than its budget: twice
// what `tests/e2e/timings.json` measured for it, plus `SLACK_S` for runner noise. It reads the
// committed file, never the working tree: CI overwrites that copy with the branch's own
// measurements before the suite starts, which would let a run raise its own budget.

import { execFileSync } from "node:child_process";
import path from "node:path";

/** @returns {Record<string, number>} */
export function committedTimings() {
  return JSON.parse(execFileSync("git", ["show", "HEAD:tests/e2e/timings.json"], { encoding: "utf8" }));
}

export const RATIO = 2;
export const SLACK_S = 30;

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
  /** @type {Set<string>} */
  skipped = new Set();
  /** Keyed by the test object, which Playwright hands every retry of one test. @type {WeakMap<object, number>} */
  lastAttempt = new WeakMap();
  testDir = "";

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
    this.ms[file] = (this.ms[file] ?? 0) + result.duration - (this.lastAttempt.get(test) ?? 0);
    this.lastAttempt.set(test, result.duration);
  }

  /** @param {any} result */
  onEnd(result) {
    if (!process.env.CI || result.status !== "passed") return;
    /** @type {Record<string, number>} */
    const measured = {};
    for (const [file, ms] of Object.entries(this.ms)) if (!this.skipped.has(file)) measured[file] = Math.round(ms / 100) / 10;
    const over = overBudget(measured, committedTimings());
    for (const { file, seconds, budget } of over) {
      process.stdout.write(
        `::error::${file} took ${seconds}s against a budget of ${budget}s (${RATIO}× its measured time in tests/e2e/timings.json + ${SLACK_S}s). ` +
          `Find what made it slower; if the extra checking is worth it, put this run's time in timings.json in the same change.\n`
      );
    }
    if (over.length > 0) return { status: "failed" };
  }
}
