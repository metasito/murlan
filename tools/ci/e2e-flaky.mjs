// The browser suite retries once on CI, so a real race passes on the retry every run. Playwright
// marks that test `flaky` in the merged report; this puts each one where a reader will see it.

import { appendFileSync, readFileSync } from "node:fs";

import { isInvokedDirectly } from "../../scripts/lib/entry.mjs";

/**
 * @param {any} report a merged Playwright JSON report
 * @returns {string[]} `<file> › <title>` for every test that failed before it passed
 */
export function flakyFromReport(report) {
  /** @type {string[]} */
  const flaky = [];
  /** @param {any} suite @param {string} file */
  const walk = (suite, file) => {
    for (const spec of suite.specs ?? []) {
      if ((spec.tests ?? []).some((/** @type {any} */ t) => t.status === "flaky")) flaky.push(`${file} › ${spec.title}`);
    }
    for (const nested of suite.suites ?? []) walk(nested, file);
  };
  const files = report.suites ?? [];
  if (files.length === 0) throw new Error("the report holds no spec files");
  for (const suite of files) walk(suite, suite.file);
  return flaky;
}

if (isInvokedDirectly(process.argv[1], import.meta.url)) {
  const [report] = process.argv.slice(2);
  if (!report) throw new Error("usage: node tools/ci/e2e-flaky.mjs <merged-report.json>");

  const flaky = flakyFromReport(JSON.parse(readFileSync(report, "utf8")));
  for (const name of flaky) process.stdout.write(`::warning::Flaky, passed on retry: ${name}\n`);
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) {
    const list = flaky.map((name) => `- ${name}\n`).join("");
    appendFileSync(summary, `### Browser tests: ${flaky.length} flaky\n\n${list}`);
  }
}
