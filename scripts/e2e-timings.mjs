// Rewrites `tests/e2e/timings.json` from a merged Playwright JSON report, which is
// the only place the real per-spec durations exist: every browser shard uploads a
// blob report and the `Browser test report` job puts the six back together.
//
// Left to a hand scrape of six job logs it does not get done — the file measured 25
// of 47 specs for months, and `tests/e2eShardSplit.test.ts` called the resulting
// split even because the other 22 shared a constant (#753).
//
// Getting a report to feed it, from a CI run whose browser shards ran:
//
//   gh run download <runId> --pattern 'blob-report-*' --dir blobs
//   mv blobs/*/*.zip blobs/            # merge-reports takes one flat directory,
//                                      # and does not descend; ci.yml gets the same
//                                      # shape from download-artifact's merge-multiple
//   npx playwright merge-reports --reporter json blobs > merged.json
//   node scripts/e2e-timings.mjs merged.json

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { isInvokedDirectly, specFilesIn } from "./e2e-shard.mjs";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const TIMINGS = path.join(repoRoot, "tests", "e2e", "timings.json");

/**
 * Every test's own duration, summed per spec file. Playwright runs this suite
 * `workers: 1, fullyParallel: false` (tests/e2e/playwright.config.ts), so within a
 * shard the sum is what the shard spends, which is what the split needs.
 *
 * Two kinds of file come back unpriced rather than cheap, because a small number
 * here is indistinguishable from a measured one and `assignShards` reads `0` as
 * free — it would stack the file with real work for as long as the entry stood:
 *
 *   - one whose run skipped a test. `menuHeight.spec.ts` decides at runtime, so
 *     which files these are changes from run to run.
 *   - one that rounds to nothing. `musicLoops.spec.ts` decodes three tracks in
 *     `beforeAll` and leaves its test bodies pure arithmetic over the result, and
 *     a hook's time appears in no `result.duration`.
 *
 * @param {any} report a merged Playwright JSON report
 * @returns {{ seconds: Record<string, number>, unpriced: Record<string, string> }}
 */
export function timingsFromReport(report) {
  /** @type {Record<string, number>} */
  const ms = {};
  /** @type {Record<string, string>} */
  const unpriced = {};

  /** @param {any} suite @param {string} file */
  const walk = (suite, file) => {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        if (test.status === "skipped") unpriced[file] = `skipped "${spec.title}"`;
        for (const result of test.results ?? []) ms[file] = (ms[file] ?? 0) + (result.duration ?? 0);
      }
    }
    for (const nested of suite.suites ?? []) walk(nested, file);
  };

  for (const suite of report.suites ?? []) walk(suite, suite.file);
  if (Object.keys(ms).length === 0) throw new Error("the report holds no spec files");

  /** @type {Record<string, number>} */
  const seconds = {};
  for (const [file, total] of Object.entries(ms).sort(([a], [b]) => a.localeCompare(b))) {
    const rounded = Math.round(total / 100) / 10;
    if (rounded === 0) unpriced[file] ??= "spends its time outside its test bodies";
    if (!(file in unpriced)) seconds[file] = rounded;
  }
  return { seconds, unpriced };
}

/**
 * Refuses a set of timings that does not cover the whole suite — one shard's blob
 * missing from the merge, or a spec no run has ever priced. Written out, every
 * absent spec would drop back to the guess this file exists to remove, silently.
 *
 * @param {Record<string, number>} timings
 * @param {string[]} files
 * @returns {string | null}
 */
export function coverageGap(timings, files) {
  const missing = files.filter((file) => !(file in timings));
  const covered = files.filter((file) => file in timings).length;
  return missing.length === 0
    ? null
    : `${covered} of the suite's ${files.length} specs have a duration; nothing has ever ` +
        `measured ${missing.join(", ")}`;
}

if (isInvokedDirectly(process.argv[1], import.meta.url)) {
  const [report] = process.argv.slice(2);
  if (!report) throw new Error("usage: node scripts/e2e-timings.mjs <merged-report.json>");

  const { seconds, unpriced } = timingsFromReport(JSON.parse(readFileSync(report, "utf8")));
  const files = specFilesIn();
  // Merged over what is already recorded rather than replacing it: a file this run
  // could not price keeps the last run that could, so one runtime skip cannot empty
  // the file the shard split depends on.
  const previous = existsSync(TIMINGS) ? JSON.parse(readFileSync(TIMINGS, "utf8")) : {};
  const merged = Object.fromEntries(
    files.filter((file) => file in seconds || file in previous).map((file) => [file, seconds[file] ?? previous[file]])
  );

  const gap = coverageGap(merged, files);
  if (gap) throw new Error(gap);

  writeFileSync(TIMINGS, `${JSON.stringify(merged, null, 2)}\n`);
  const total = Object.values(merged).reduce((a, b) => a + b, 0);
  process.stdout.write(`${Object.keys(merged).length} specs, ${total.toFixed(0)}s -> tests/e2e/timings.json\n`);
  for (const [file, why] of Object.entries(unpriced)) {
    if (files.includes(file)) process.stdout.write(`  kept ${merged[file]}s for ${file}: this run ${why}\n`);
  }
}
