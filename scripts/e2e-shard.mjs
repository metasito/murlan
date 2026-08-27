// Which spec files a browser shard runs. Playwright's own `--shard` splits by
// test *count* (playwright.dev/docs/test-sharding), and this suite's tests
// range from under a second to ninety-four, so an even count is an uneven
// runner: the run waited 5m20s on one shard while another idled from 2m11s.
//
// The split is by measured duration instead, longest file first into whichever
// shard is currently lightest. `tests/e2e/timings.json` holds the measurements;
// a file missing from it still gets placed, so a new spec can never silently
// run nowhere. tests/e2eShardSplit.test.ts pins both properties.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const E2E_DIR = path.join(here, "..", "tests", "e2e");
const TIMINGS = path.join(E2E_DIR, "timings.json");

/**
 * What to assume a spec costs when nothing has measured it. Deliberately well
 * above this suite's median: a new spec is placed pessimistically, so the worst
 * an unmeasured file does is finish early.
 */
export const UNMEASURED_SECONDS = 60;

/**
 * `webPerf` is excluded here for the same reason playwright.config.ts ignores it.
 * @returns {string[]}
 */
export function specFilesIn(dir = E2E_DIR) {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".spec.ts") && name !== "webPerf.spec.ts")
    .sort();
}

/** @returns {Record<string, number>} */
export function readTimings(file = TIMINGS) {
  return JSON.parse(readFileSync(file, "utf8"));
}

/**
 * Longest-processing-time first: the standard greedy for this, and within a
 * third of optimal in the worst case. Ties break on the name so that two runs
 * of the same suite always produce the same split.
 *
 * @param {string[]} files
 * @param {Record<string, number>} timings
 * @param {number} total
 * @returns {{ files: string[], seconds: number }[]}
 */
export function assignShards(files, timings, total) {
  if (!Number.isInteger(total) || total < 1) {
    throw new Error(`shard count must be a positive integer, got ${total}`);
  }
  const shards = Array.from({ length: total }, () => ({
    /** @type {string[]} */ files: [],
    seconds: 0,
  }));
  const weighted = files
    .map((file) => ({ file, seconds: timings[file] ?? UNMEASURED_SECONDS }))
    .sort((a, b) => b.seconds - a.seconds || a.file.localeCompare(b.file));

  for (const { file, seconds } of weighted) {
    const lightest = shards.reduce((a, b) => (b.seconds < a.seconds ? b : a));
    lightest.files.push(file);
    lightest.seconds += seconds;
  }
  return shards.map((s) => ({ files: s.files.sort(), seconds: Math.round(s.seconds) }));
}

/** @returns {string[]} */
export function filesForShard(index, total, files = specFilesIn(), timings = readTimings()) {
  if (!Number.isInteger(index) || index < 1 || index > total) {
    throw new Error(`shard index must be 1..${total}, got ${index}`);
  }
  return assignShards(files, timings, total)[index - 1].files;
}

export function isInvokedDirectly(argv1, moduleUrl) {
  return Boolean(argv1) && pathToFileURL(path.resolve(argv1)).href === moduleUrl;
}

if (isInvokedDirectly(process.argv[1], import.meta.url)) {
  const [index, total] = process.argv.slice(2).map(Number);
  // Full paths, not bare names: Playwright reads each argument as a regular
  // expression against the file path, and `offline.spec.ts` is a prefix of
  // two other specs.
  process.stdout.write(filesForShard(index, total).map((f) => `tests/e2e/${f}`).join(" "));
}
