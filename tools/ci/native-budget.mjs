// A jest reporter that fails a CI run of the native suite when one test file's cases, on one project,
// take longer than its budget, read from the run's own results (what `--json` writes). The cases and
// not the file's `PASS … (N s)`: that one also holds the module graph's transform, which a cold cache
// makes 30 s on whichever file loads it first, so it would charge the file nothing in it chose.

import path from "node:path";

/** Native tests run 36810983892 and 36802620558: past the four files of #1368, the slowest took 11.5 s cold. */
export const BUDGET_S = 15;

/** No exception may grant more: one file alone at a minute is the whole job's share of five. */
export const MAX_EXCEPTION_S = 60;

/** A file past `BUDGET_S` by design, keyed `project:path`: its own ceiling, and why it costs that. */
export const EXCEPTIONS = {
  "ios:tests/native/oneSoundPerMoment.test.tsx": {
    seconds: 60,
    why: "Plays a whole bot manche, every move held as long as an offline bot thinks: its claim is about every state change of one, and a prefix would be a weaker claim.",
  },
  "ios:tests/native/pileMountsOnceFull.test.tsx": {
    seconds: 45,
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
    this.measured[`${project}:${file}`] = result.testResults.reduce((sum, t) => sum + (t.duration ?? 0), 0) / 1000;
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
      const over = overBudget(this.measured);
      for (const { file, seconds, budget } of over) {
        process.stdout.write(
          `::error::${file} took ${seconds.toFixed(1)}s against a budget of ${budget}s (tools/ci/native-budget.mjs). ` +
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
