// Which spec files a browser shard runs. Playwright's own `--shard` splits by
// test *count* (playwright.dev/docs/test-sharding), and this suite's tests
// range from under a second to ninety-four, so an even count is an uneven
// runner: the run waited 5m20s on one shard while another idled from 2m11s.
//
// The split is by measured duration instead, longest file first into whichever
// shard is currently lightest. `tests/e2e/timings.json` holds the measurements;
// a file missing from it still gets placed, so a new spec can never silently
// run nowhere. tests/tooling/e2eShardSplit.test.ts pins both properties.

import { appendFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isInvokedDirectly } from "../../scripts/lib/entry.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const E2E_DIR = path.join(here, "..", "..", "tests", "e2e");
const TIMINGS = path.join(E2E_DIR, "timings.json");

/**
 * What to assume a spec costs when nothing has measured it. Deliberately well
 * above this suite's median: a new spec is placed pessimistically, so the worst
 * an unmeasured file does is finish early.
 */
export const UNMEASURED_SECONDS = 60;

/** The slowest browser job's wall clock, setup included (#1285). */
export const TARGET_JOB_SECONDS = 300;
/** A shard's time outside its specs — npm ci, the browser, the bundle, Postgres, the boot — measured in docs/research/2026-09-25-ci-speed.md. */
export const SHARD_OVERHEAD_SECONDS = 90;
/** Every shard is a concurrent job, and a public repository's runners allow 20 at once across every run. */
export const MAX_SHARDS = 12;

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

/**
 * Oldest first: the committed file, then main's latest green run, then this branch's. A later
 * measurement wins, so a spec the branch made heavier is priced as the branch runs it.
 * @param {(Record<string, number> | null)[]} layers
 * @returns {Record<string, number>}
 */
export const resolveTimings = (...layers) => Object.assign({}, ...layers);

/**
 * As many shards as it takes for the suite to fit the target, overhead and all. Unclamped:
 * above `MAX_SHARDS` the target is out of reach, and `e2eShardSplit.test.ts` says so.
 * @param {string[]} files
 * @param {Record<string, number>} timings
 */
export function shardsNeeded(files, timings) {
  const total = files.reduce((sum, f) => sum + (timings[f] ?? UNMEASURED_SECONDS), 0);
  return Math.max(2, Math.ceil(total / (TARGET_JOB_SECONDS - SHARD_OVERHEAD_SECONDS)));
}

/**
 * @param {string[]} layerFiles JSON timings files, oldest first; a missing one is skipped
 * @returns {{ shards: number[], timings: Record<string, number> }}
 */
export function plan(layerFiles, files = specFilesIn()) {
  const timings = resolveTimings(...layerFiles.filter((f) => existsSync(f)).map((f) => readTimings(f)));
  const count = Math.min(MAX_SHARDS, shardsNeeded(files, timings));
  return { shards: Array.from({ length: count }, (_, i) => i + 1), timings };
}

if (isInvokedDirectly(process.argv[1], import.meta.url) && process.argv[2] === "plan") {
  const { shards, timings } = plan([TIMINGS, ...process.argv.slice(3)]);
  const out = `shards=${JSON.stringify(shards)}\nshard-count=${shards.length}\ntimings=${JSON.stringify(timings)}\n`;
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, out);
  process.stdout.write(out);
} else if (isInvokedDirectly(process.argv[1], import.meta.url)) {
  const [index, total] = process.argv.slice(2).map(Number);
  // Full paths, not bare names: Playwright reads each argument as a regular
  // expression against the file path, and `offline.spec.ts` is a prefix of
  // two other specs.
  process.stdout.write(filesForShard(index, total).map((f) => `tests/e2e/${f}`).join(" "));
}
