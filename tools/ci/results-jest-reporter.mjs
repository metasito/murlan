/** jest's side of tools/ci/results-writer.mjs, listed in jest.config.js's `reporters`. */
import { openResults, repoPath } from "./results-writer.mjs";

/** @type {Record<string, import("./results-writer.mjs").Status>} */
const STATUS = { passed: "passed", failed: "failed", todo: "todo", pending: "skipped", skipped: "skipped", disabled: "skipped", focused: "passed" };

export default class JestResults {
  /** @param {any} globalConfig */
  constructor(globalConfig) {
    this.rootDir = globalConfig?.rootDir ?? process.cwd();
    const filtering = ["testNamePattern", "onlyChanged", "onlyFailures", "lastCommit", "changedSince", "findRelatedTests"];
    const filters = filtering.filter((k) => globalConfig?.[k]).map((k) => `${k} ${globalConfig[k]}`);
    this.out = openResults("jest", process.env, filters);
  }

  /** @param {any} test @param {any} result */
  onTestResult(test, result) {
    const file = repoPath(result.testFilePath, this.rootDir);
    const project = test.context.config.displayName?.name ?? "default";
    if (result.testExecError) this.out.write({ type: "test", file, title: "(the file did not run)", status: "failed", project });
    for (const t of result.testResults) {
      const title = [...t.ancestorTitles, t.title].join(" › ");
      this.out.write({ type: "test", file, title, status: STATUS[t.status] ?? "failed", attempt: Math.max(0, (t.invocations ?? 1) - 1), project });
    }
  }

  /** @param {unknown} _contexts @param {any} results */
  onRunComplete(_contexts, results) {
    // jest sets `results.success` only after every reporter's onRunComplete has returned.
    const ok = results.numFailedTests === 0 && results.numFailedTestSuites === 0 && results.numRuntimeErrorTestSuites === 0 && !results.wasInterrupted;
    this.out.write({ type: "end", ok, counts: { tests: results.numTotalTests, failed: results.numFailedTests, skipped: results.numPendingTests, todo: results.numTodoTests } });
  }
}
