// The browser suite retries once on CI, so a real race passes on the retry every run. Playwright
// marks that test `flaky` in the merged report; this fails the run on each one, by name, unless
// an open issue already owns it.

import { appendFileSync, readFileSync } from "node:fs";

import { isInvokedDirectly } from "../../scripts/lib/entry.mjs";

/**
 * `<file> › <title>` of a test known to race, and the open issue that owns its fix. An entry
 * whose issue is closed fails the run like an unlisted one: the fix landed, or the excuse did.
 * @type {[string, number][]}
 */
export const KNOWN_FLAKY = [];

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

/**
 * @param {string[]} flaky
 * @param {[string, number][]} known
 * @param {(issue: number) => Promise<boolean>} isOpen
 * @returns {Promise<{ excused: [string, number][], failed: string[] }>}
 */
export async function verdict(flaky, known, isOpen) {
  /** @type {[string, number][]} */
  const excused = [];
  /** @type {string[]} */
  const failed = [];
  for (const name of flaky) {
    const issue = known.find(([k]) => k === name)?.[1];
    if (issue !== undefined && (await isOpen(issue))) excused.push([name, issue]);
    else failed.push(name);
  }
  return { excused, failed };
}

/** @param {number} issue */
async function issueIsOpen(issue) {
  const repo = process.env.GITHUB_REPOSITORY ?? "metasito/murlan";
  const token = process.env.GITHUB_TOKEN;
  const res = await fetch(`https://api.github.com/repos/${repo}/issues/${issue}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`could not read issue #${issue} (HTTP ${res.status}), so cannot excuse its flaky test`);
  return (await res.json()).state === "open";
}

if (isInvokedDirectly(process.argv[1], import.meta.url)) {
  const [report] = process.argv.slice(2);
  if (!report) throw new Error("usage: node tools/ci/e2e-flaky.mjs <merged-report.json>");

  const flaky = flakyFromReport(JSON.parse(readFileSync(report, "utf8")));
  const { excused, failed } = await verdict(flaky, KNOWN_FLAKY, (issue) =>
    issueIsOpen(issue).catch((/** @type {Error} */ err) => {
      process.stdout.write(`::error::${err.message}; give this step GITHUB_TOKEN\n`);
      return false;
    })
  );
  for (const [name, issue] of excused) process.stdout.write(`::warning::Flaky, passed on retry (owned by #${issue}): ${name}\n`);
  for (const name of failed) {
    process.stdout.write(
      `::error::Flaky, passed on retry: ${name} — a race, not a pass. Fix it at its mechanism, ` +
        `or list it in KNOWN_FLAKY (tools/ci/e2e-flaky.mjs) with the open issue that owns the fix.\n`
    );
  }
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) {
    const list = flaky.map((name) => `- ${name}\n`).join("");
    appendFileSync(summary, `### Browser tests: ${flaky.length} flaky\n\n${list}`);
  }
  if (failed.length > 0) process.exitCode = 1;
}
