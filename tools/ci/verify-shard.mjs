// Which test files a `verify` shard runs, and running them as `npm test` would. node:test sorts the
// files it is handed (createTestFileList) and starts them in that order, LANES at a time, so a long
// file that sorts last starts last and runs on alone: an even split of seconds is not an even split
// of wall clock. Each file goes, longest first, to whichever shard it finishes soonest on, by a model
// of that scheduler over the seconds main's recent runs measured (results-writer.mjs's TIMINGS_SUFFIX).
// The split only orders work: CI gate's verdict holds the shards together to the whole listing.

import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, globSync, readFileSync } from "node:fs";
import path from "node:path";
import { isInvokedDirectly } from "../../scripts/lib/entry.mjs";
import { medianTimings } from "./e2e-shard.mjs";

/** package.json's `test` script names its files by this glob, which a shard's list replaces. */
export const TEST_GLOB = '"tests/**/*.test.ts"';

/** @param {string} script package.json's `test` */
export const lanesOf = (script) => Number(/--test-concurrency=(\d+)/.exec(script)?.[1] ?? 1);

/** What `npm test` runs, as paths from the repository root. */
export const listing = (cwd = process.cwd()) =>
  globSync(JSON.parse(TEST_GLOB), { cwd })
    .map((f) => f.split(path.sep).join("/"))
    .sort();

/**
 * When the last of `files` finishes, started in sorted order `lanes` at a time.
 * @param {string[]} files
 * @param {(file: string) => number} cost
 * @param {number} lanes
 */
export function makespan(files, cost, lanes) {
  const free = Array(lanes).fill(0);
  let end = 0;
  for (const f of [...files].sort()) {
    let i = 0;
    for (let j = 1; j < lanes; j++) if (free[j] < free[i]) i = j;
    free[i] += cost(f);
    end = Math.max(end, free[i]);
  }
  return end;
}

/**
 * A file nothing measured costs the median of those something did: a new file is a typical file.
 * Ties break on the name, so every shard of a run computes the same split.
 * @param {string[]} files
 * @param {Record<string, number>} seconds
 * @param {number} total
 * @param {number} lanes
 * @returns {string[][]}
 */
export function assign(files, seconds, total, lanes) {
  if (!Number.isInteger(total) || total < 1) throw new Error(`shard count must be a positive integer, got ${total}`);
  const measured = files.map((f) => seconds[f]).filter((s) => typeof s === "number" && s >= 0).sort((a, b) => a - b);
  const typical = measured.length ? /** @type {number} */ (measured[measured.length >> 1]) : 1;
  const cost = (/** @type {string} */ f) => seconds[f] ?? typical;
  /** @type {string[][]} */
  const shards = Array.from({ length: total }, () => []);
  for (const f of [...files].sort((a, b) => cost(b) - cost(a) || a.localeCompare(b))) {
    let best = 0;
    let soonest = Infinity;
    shards.forEach((shard, k) => {
      const t = makespan([...shard, f], cost, lanes);
      if (t < soonest) [best, soonest] = [k, t];
    });
    /** @type {string[]} */ (shards[best]).push(f);
  }
  return shards.map((s) => s.sort());
}

/**
 * One layer of seconds from `runs`, each a list of timings files one run's shards wrote: a file at
 * the median of the runs that measured it.
 * @param {string[][]} runs
 */
export const timingsOf = (runs) =>
  medianTimings(runs.map((files) => Object.assign({}, ...files.filter((f) => existsSync(f)).map((f) => JSON.parse(readFileSync(f, "utf8"))))));

/**
 * `npm test`'s own command as an argv, its glob swapped for `files`.
 * @param {string} script
 * @param {string[]} files
 */
export function commandFor(script, files) {
  const words = script.trim().split(/\s+/);
  if (!words.includes(TEST_GLOB)) throw new Error(`package.json's test script no longer names ${TEST_GLOB}`);
  const odd = words.filter((w) => w !== TEST_GLOB && !/^[\w./=:-]+$/.test(w));
  if (odd.length) throw new Error(`package.json's test script no longer runs without a shell: ${odd.join(" ")}`);
  if (!files.length) throw new Error("a shard with no files would run the runner's default set");
  return words.flatMap((w) => (w === TEST_GLOB ? files : [w]));
}

if (isInvokedDirectly(process.argv[1], import.meta.url)) {
  const [verb, ...args] = process.argv.slice(2);
  if (verb === "plan") {
    // Each argument is one run: its shards' timings files, comma-separated.
    const out = `verify-timings=${JSON.stringify(timingsOf(args.map((a) => a.split(",").filter(Boolean))))}\n`;
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, out);
    process.stdout.write(`${out.length} bytes of timings over ${args.length} runs\n`);
  } else if (verb === "run") {
    const [index, total, timings] = args;
    const script = JSON.parse(readFileSync("package.json", "utf8")).scripts.test;
    const measured = timings ? readFileSync(timings, "utf8").trim() : "";
    const shards = assign(listing(), measured ? JSON.parse(measured) : {}, Number(total), lanesOf(script));
    const files = shards[Number(index) - 1];
    if (!files) throw new Error(`shard ${index} of ${total} does not exist`);
    process.stdout.write(`Shard ${index}/${total}: ${files.length} files\n`);
    const [bin, ...argv] = commandFor(script, files);
    process.exitCode = spawnSync(bin === "node" ? process.execPath : bin, argv, { stdio: "inherit" }).status ?? 1;
  } else {
    throw new Error("usage: verify-shard.mjs plan <run> ... | run <index> <total> [timings.json]");
  }
}
