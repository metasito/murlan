// A jest reporter that fails a CI run of the native suite when one test file's cases, on one project,
// take longer than its budget, read from the run's own results (what `--json` writes). The cases are
// budgeted apart from the rest of `PASS … (N s)`, which also holds the module graph's transform that a
// cold cache charges to whichever file loads it first; the rest gets a ceiling of its own, so work moved
// into a beforeAll or a module body cannot leave the budget.

import path from "node:path";

/** Under twice the slowest file outside the exceptions, exchangeOnTable's 8.5 s in run 36817916976. */
export const BUDGET_S = 15;

/** A file's time outside its cases (module load, describe bodies, beforeAll, afterAll) on a cold transform cache, run COLD_RUN. */
export const OUTSIDE_S = 45;

/** No exception may grant more: one file alone at a minute is the whole job's share of five. */
export const MAX_EXCEPTION_S = 60;

/** A file past `BUDGET_S` by design, keyed `project:path`: its ceiling, about twice what run 36817916976 measured, and why. */
export const EXCEPTIONS = {
  "ios:tests/native/oneSoundPerMoment.test.tsx": {
    seconds: 60,
    why: "Plays a whole bot manche, every move held as long as an offline bot thinks: its claim is about every state change of one, and a prefix would be a weaker claim.",
  },
  "ios:tests/native/everyMomentHasACaller.test.tsx": {
    seconds: 30,
    why: "Plays a bot manche until a trick has closed and the next one opened, which a random deal reaches in a varying number of moves: 11.4 s and 13.2 s on one tree.",
  },
  "ios:tests/native/pileMountsOnceFull.test.tsx": {
    seconds: 35,
    why: "Plays four tricks under full motion, each card's flight run frame by frame to its sweep, until three are in the air at once.",
  },
};

/**
 * @param {Record<string, number>} measured seconds per `project:path`
 * @param {Record<string, { seconds: number }>} exceptions
 * @returns {{ file: string, seconds: number, budget: number }[]}
 */
export function overBudget(measured, exceptions = EXCEPTIONS) {
  return Object.entries(measured)
    .map(([file, seconds]) => ({ file, seconds, budget: exceptions[file]?.seconds ?? BUDGET_S }))
    .filter(({ seconds, budget }) => seconds > budget);
}

export default class NativeBudgetReporter {
  /** @type {Record<string, number>} */
  measured = {};
  /** @type {Record<string, number>} */
  outside = {};
  /** @type {Error | undefined} */
  error;

  /** @param {any} globalConfig */
  constructor(globalConfig) {
    this.rootDir = globalConfig?.rootDir ?? process.cwd();
  }

  /** @param {any} test @param {any} result */
  onTestResult(test, result) {
    const project = test.context.config.displayName?.name ?? "default";
    const file = path.relative(this.rootDir, result.testFilePath).split(path.sep).join("/");
    const cases = result.testResults.reduce((sum, t) => sum + (t.duration ?? 0), 0) / 1000;
    this.measured[`${project}:${file}`] = cases;
    this.outside[`${project}:${file}`] = Math.max(0, result.perfStats.runtime / 1000 - cases);
  }

  /** @param {unknown} _contexts @param {any} results */
  onRunComplete(_contexts, results) {
    const slowest = Object.entries(this.measured).sort(([, a], [, b]) => b - a);
    if (!slowest.some(([, seconds]) => seconds > 0)) {
      this.error = new Error(`The native budget measured ${slowest.length} files and no time in any: whatever it reads stopped reaching it.`);
    } else if (results.numFailedTestSuites > 0) {
      return;
    } else {
      process.stdout.write(`Native budget, slowest cases per file:\n${slowest.slice(0, 12).map(([f, s]) => `  ${s.toFixed(1)}s ${f}`).join("\n")}\n`);
      const outside = Object.entries(this.outside).sort(([, a], [, b]) => b - a);
      process.stdout.write(`Native budget, most time outside the cases:\n${outside.slice(0, 6).map(([f, s]) => `  ${s.toFixed(1)}s ${f}`).join("\n")}\n`);
      const over = [
        ...overBudget(this.measured).map((o) => ({ ...o, what: "its cases" })),
        ...outside.filter(([, s]) => s > OUTSIDE_S).map(([file, seconds]) => ({ file, seconds, budget: OUTSIDE_S, what: "outside its cases" })),
      ];
      for (const { file, seconds, budget, what } of over) {
        process.stdout.write(
          `::error::${file} spent ${seconds.toFixed(1)}s ${what} against a budget of ${budget}s (tools/ci/native-budget.mjs). ` +
            `Find what made it slow; split it, or shrink what it plays to what it asserts.\n`
        );
      }
      if (over.length > 0) this.error = new Error(`${over.length} native test file(s) over budget`);
    }
    if (this.error) process.stdout.write(`::error::${this.error.message}\n`);
  }

  getLastError() {
    return this.error;
  }
}
