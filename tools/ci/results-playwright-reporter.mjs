/** Playwright's side of tools/ci/results-writer.mjs, listed in each Playwright config's `reporter`. */
import { openResults, repoPath } from "./results-writer.mjs";

export default class PlaywrightResults {
  /** @type {ReturnType<typeof openResults>} */
  out = { write: () => {}, file: undefined };
  /** @type {Set<string>} */
  planned = new Set();
  /** @type {Set<string>} */
  ended = new Set();

  printsToStdio() {
    return false;
  }

  /** @param {any} test */
  static key(test) {
    // `test.location` is where `test()` was called, which for a test a helper registers is the helper.
    let spec = test.parent;
    while (spec.type !== "file") spec = spec.parent;
    return { file: repoPath(spec.location.file), title: test.titlePath().slice(3).join(" › "), project: test.parent.project()?.name ?? "" };
  }

  /** @param {any} config @param {any} suite */
  onBegin(config, suite) {
    const filters = [config, ...config.projects].flatMap((/** @type {any} */ c) => [
      ...[c.grep].flat().filter((/** @type {RegExp} */ g) => g && g.source !== ".*").map((/** @type {RegExp} */ g) => `grep ${g}`),
      ...[c.grepInvert].flat().filter(Boolean).map((/** @type {RegExp} */ g) => `grep-invert ${g}`),
    ]);
    // The command line's own filters never reach `config`: the runner applies them beside it.
    const cli = process.argv.filter((a) => /^(-g|--grep|--grep-invert|--last-failed|--only-changed|--test-list|--test-list-invert|--project)(=|$)/.test(a));
    this.out = openResults("playwright", process.env, [...new Set([...filters, ...cli])]);
    for (const test of suite.allTests()) this.planned.add(test.id);
  }

  /** @param {any} test @param {any} result */
  onTestEnd(test, result) {
    this.ended.add(test.id);
    const status = result.status === "skipped" ? "skipped" : result.status === test.expectedStatus ? "passed" : "failed";
    this.out.write({ type: "test", ...PlaywrightResults.key(test), status, attempt: result.retry, retries: test.retries });
  }

  /** @param {any} test @param {any} _result @param {any} step */
  onStepEnd(test, _result, step) {
    if (!step.annotations?.some((/** @type {{ type: string }} */ a) => a.type === "skip" || a.type === "fixme")) return;
    const { file, title, project } = PlaywrightResults.key(test);
    this.out.write({ type: "test", file, title: `${title} › ${step.titlePath().join(" › ")}`, status: "skipped", project });
  }

  /** @param {any} result */
  onEnd(result) {
    const missing = [...this.planned].filter((id) => !this.ended.has(id)).length;
    this.out.write({ type: "end", ok: result.status === "passed" && missing === 0, counts: { planned: this.planned.size, missing } });
  }
}
