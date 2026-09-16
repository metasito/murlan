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
import { fileURLToPath } from "node:url";
import { isInvokedDirectly } from "./lib/entry.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const E2E_DIR = path.join(here, "..", "tests", "e2e");
const TIMINGS = path.join(E2E_DIR, "timings.json");

/**
 * What to assume a spec costs when nothing has measured it. Deliberately well
 * above this suite's median: a new spec is placed pessimistically, so the worst
 * an unmeasured file does is finish early.
 */
export const UNMEASURED_SECONDS = 60;

const CONFIG = path.join(E2E_DIR, "playwright.config.ts");

/**
 * What Playwright runs from `dir`: a recursive walk under its default testMatch, minus the
 * config's `testIgnore`, as paths relative to `dir` — the form timings.json keys take.
 * @returns {string[]}
 */
export function specFilesIn(dir = E2E_DIR) {
  const ignore = /testIgnore: \/(.+)\/,$/m.exec(readFileSync(CONFIG, "utf8"));
  if (!ignore) throw new Error(`${CONFIG} declares no testIgnore regex`);
  return readdirSync(dir, { recursive: true })
    .map((name) => String(name).split(path.sep).join("/"))
    .filter((name) => /\.(spec|test)\.[cm]?[jt]sx?$/.test(name) && !new RegExp(ignore[1]).test(name))
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

if (isInvokedDirectly(process.argv[1], import.meta.url)) {
  const [index, total] = process.argv.slice(2).map(Number);
  // Full paths, not bare names: Playwright reads each argument as a regular
  // expression against the file path, and `offline.spec.ts` is a prefix of
  // two other specs.
  process.stdout.write(filesForShard(index, total).map((f) => `tests/e2e/${f}`).join(" "));
}
