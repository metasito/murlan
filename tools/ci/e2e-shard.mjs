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
import { prSpec } from "../../tests/e2e/tiers.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const E2E_DIR = path.join(here, "..", "..", "tests", "e2e");
export const TIMINGS = path.join(E2E_DIR, "timings.json");

/**
 * What to assume a spec costs when nothing has measured it. Deliberately well
 * above this suite's median: a new spec is placed pessimistically, so the worst
 * an unmeasured file does is finish early.
 */
export const UNMEASURED_SECONDS = 60;

/** How much of the suite may sit at `UNMEASURED_SECONDS` and the split still be about time: a constant divides evenly. */
export const UNMEASURED_SHARE = 0.1;

/** A pull request's ci.yml wall clock, first job to last, device compiles aside: the owner's, docs/agents/RULES.md rule 46. */
export const TARGET_RUN_SECONDS = 300;
/** Run 37792764075, 17 shards: the scope job before them and the report after, 10 s and 29 s. */
export const AROUND_SHARDS_SECONDS = 39;
/** Same run: a shard's wall clock less its specs, median of 17 — install, browser, bundle export, boot, upload. */
export const SHARD_OVERHEAD_SECONDS = 52;
/** Same run: the slowest shard's specs against the mean shard's, 1.32. */
export const SHARD_NOISE = 1.32;
/** Not the documented 20: at 2026-11-11T13:48:34Z, 42 Linux jobs of every workflow ran at once with none queued over 5 s (#2070). */
export const MAX_CONCURRENT_JOBS = 42;
/** What that leaves beside every job ci.yml starts with the shards; `e2eShardSplit.test.ts` counts them. */
export const MAX_SHARDS = 17;

/**
 * What Playwright runs from `dir` on a pull request: a recursive walk kept to `prSpec`, as paths
 * relative to `dir` — the form timings.json keys take.
 * @returns {string[]}
 */
export function specFilesIn(dir = E2E_DIR) {
  return readdirSync(dir, { recursive: true })
    .map((name) => String(name).split(path.sep).join("/"))
    .filter(prSpec)
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
 * Oldest first: the committed file, then main's recent green runs, then this branch's. A later
 * measurement wins, so a spec the branch made heavier is priced as the branch runs it.
 * @param {(Record<string, number> | null)[]} layers
 * @returns {Record<string, number>}
 */
export const resolveTimings = (...layers) => Object.assign({}, ...layers);

/**
 * One branch's recent runs as one layer: each spec at the median of the runs that measured it.
 * The latest run alone is one sample of specs whose own time swings 26–93 s, and it moved whole
 * shards by a minute (docs/research/2026-09-25-ci-speed.md § Shard balance).
 * @param {Record<string, number>[]} runs
 * @returns {Record<string, number>}
 */
export function medianTimings(runs) {
  /** @type {Record<string, number[]>} */
  const samples = {};
  for (const run of runs) for (const [file, s] of Object.entries(run)) (samples[file] ??= []).push(s);
  return Object.fromEntries(
    Object.entries(samples).map(([file, list]) => {
      const sorted = list.sort((a, b) => a - b);
      const mid = sorted.length >> 1;
      return [file, sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2];
    })
  );
}

/**
 * As many shards as it takes for the suite to fit the target, overhead and all. Unclamped:
 * above `MAX_SHARDS` the target is out of reach, and `fitProblems` says so.
 * @param {string[]} files
 * @param {Record<string, number>} timings
 */
export function shardsNeeded(files, timings) {
  const total = files.reduce((sum, f) => sum + (timings[f] ?? UNMEASURED_SECONDS), 0);
  const budget = (TARGET_RUN_SECONDS - AROUND_SHARDS_SECONDS - SHARD_OVERHEAD_SECONDS) / SHARD_NOISE;
  return Math.max(2, Math.ceil(total / budget));
}

/**
 * Always `MAX_SHARDS`: wall clock falls with every shard down to the longest spec, and runners are free here.
 * @param {(string | string[])[]} layers JSON timings files, oldest first; a list is one branch's
 *   runs, priced by `medianTimings`; a missing file is skipped
 * @param {number} [stableLayers] how many of `layers`, from the oldest, are main's, not the branch's
 * @returns {{ shards: number[], timings: Record<string, number>, stable: Record<string, number> }}
 */
export function plan(layers, stableLayers = layers.length) {
  const read = (/** @type {string[]} */ group) => group.filter((f) => existsSync(f)).map((f) => readTimings(f));
  const priced = layers.map((layer) => (Array.isArray(layer) ? medianTimings(read(layer)) : read([layer])[0] ?? null));
  return {
    shards: Array.from({ length: MAX_SHARDS }, (_, i) => i + 1),
    timings: resolveTimings(...priced),
    stable: resolveTimings(...priced.slice(0, stableLayers)),
  };
}

/**
 * How much of the split was a guess, read from `timings`, what the shards split by: a spec any
 * layer measured counts as measured.
 * @param {string[]} files
 * @param {Record<string, number>} timings
 * @param {boolean} [fork] whether the pull request is a fork's, whose runs no plan reads
 * @returns {string[]}
 */
export function guessProblems(files, timings, fork = false) {
  const guessed = files.filter((file) => !(file in timings));
  if (guessed.length <= files.length * UNMEASURED_SHARE) return [];
  const remedy = fork
    ? `A fork's runs leave no e2e-timings the plan reads, so these stay guesses until main measures them: ` +
      `land fewer new specs at once, or open the pull request from a branch of this repository.`
    : `Once this branch has a run whose browser shards all passed, push again or use "Re-run all jobs" ` +
      `to price them from it; "Re-run failed jobs" keeps this plan.`;
  return [
    `${guessed.length} of ${files.length} specs were priced at the ${UNMEASURED_SECONDS}s guess, over the ` +
      `${UNMEASURED_SHARE * 100}% the split can absorb and still be even in wall clock: ${guessed.join(", ")}. ${remedy}`,
  ];
}

/**
 * The prices that predict main's next run: main's for a spec the pull request left alone, so noise
 * in a run cannot red a change that touched no spec; this run's measurement for one it added or
 * changed, or one main has never measured. A slowdown a pull request causes through a helper or app
 * code, under specs it left alone, is priced at main's numbers and shows only once main measures it.
 * @param {Record<string, number>} stable main's prices: the committed file under main's medians
 * @param {Record<string, number>} measured this run's
 * @param {string[]} changed specs the pull request added or changed
 * @returns {Record<string, number>}
 */
export function judgedPrices(stable, measured, changed) {
  return resolveTimings(measured, stable, Object.fromEntries(changed.filter((f) => f in measured).map((f) => [f, measured[f]])));
}

/**
 * @param {string[]} files
 * @param {Record<string, number>} prices
 */
function fitOf(files, prices) {
  const seconds = (/** @type {string} */ f) => prices[f] ?? UNMEASURED_SECONDS;
  const fair = files.reduce((sum, f) => sum + seconds(f), 0) / MAX_SHARDS;
  const shards = assignShards(files, prices, MAX_SHARDS).map((s) => s.seconds);
  return {
    seconds,
    fair,
    needed: shardsNeeded(files, prices),
    over: files.filter((f) => seconds(f) > fair),
    lightest: Math.min(...shards),
    heaviest: Math.max(...shards),
    uneven: Math.max(...shards) > Math.min(...shards) * (4 / 3),
  };
}

/**
 * Whether the suite at `judged` fits the target, and splits evenly: the split is rebuilt at those
 * prices, so it is the split main's next run makes. A problem `baseline` already has is main's,
 * which main's own runs and the weekly gate report, so it is left out.
 * @param {string[]} files
 * @param {Record<string, number>} judged
 * @param {Record<string, number>} [baseline]
 * @returns {string[]}
 */
export function fitProblems(files, judged, baseline) {
  if (!files.length) return ["no spec to split: the listing found none"];
  const mine = fitOf(files, judged);
  const main = baseline && fitOf(files, baseline);
  const problems = [];
  if (mine.needed > MAX_SHARDS && !(main && main.needed > MAX_SHARDS))
    problems.push(`${mine.needed} shards to meet rule 46's ${TARGET_RUN_SECONDS} s, over the ${MAX_SHARDS} allowed`);
  // Fewer specs than shards leaves a shard empty, which no split can help.
  if (files.length >= MAX_SHARDS) {
    const over = mine.over.filter((f) => !main?.over.includes(f));
    if (over.length)
      problems.push(`over the ${mine.fair.toFixed(0)}s each of ${MAX_SHARDS} shards gets; split them: ${over.map((f) => `${f} ${mine.seconds(f)}s`).join(", ")}`);
    if (mine.uneven && !main?.uneven)
      problems.push(`shards range ${mine.lightest}s to ${mine.heaviest}s, more than a third again of the lightest`);
  }
  return problems;
}

/** @param {string[]} problems */
const report = (problems) => {
  for (const problem of problems) process.stdout.write(`::error::${problem}\n`);
  process.exitCode = problems.length ? 1 : 0;
};

if (isInvokedDirectly(process.argv[1], import.meta.url) && process.argv[2] === "check") {
  if (process.argv.length !== 7) throw new Error("check takes the plan's split-problems, main's prices, this run's, and the specs changed");
  const [planned, stable, measured, changed] = process.argv.slice(3);
  const problems = JSON.parse(planned);
  if (!Array.isArray(problems)) throw new Error(`check takes the plan's split-problems, a JSON list, got ${planned}`);
  if (changed === "?") problems.push("the pull request's base could not be read, so the specs it changed could not be priced from this run");
  const mine = changed.split(",").flatMap((f) => (f.startsWith("tests/e2e/") ? [f.slice("tests/e2e/".length)] : []));
  const main = readTimings(stable);
  report([...problems, ...fitProblems(specFilesIn(), judgedPrices(main, readTimings(measured), mine), main)]);
} else if (isInvokedDirectly(process.argv[1], import.meta.url) && process.argv[2] === "judge") {
  if (!process.argv[3]) throw new Error("judge takes the timings file a commit would land");
  const timings = readTimings(process.argv[3]);
  report([...guessProblems(specFilesIn(), timings), ...fitProblems(specFilesIn(), timings)]);
} else if (isInvokedDirectly(process.argv[1], import.meta.url) && process.argv[2] === "plan") {
  const list = (/** @type {string | undefined} */ arg) => (arg ?? "").split(",").filter(Boolean);
  const [main, branch] = process.argv.slice(3);
  const { shards, timings, stable } = plan([TIMINGS, list(main), list(branch)], 2);
  const problems = guessProblems(specFilesIn(), timings, process.env.FORK === "true");
  if (!list(main).some((f) => existsSync(f)))
    problems.push(`no run of main's e2e-timings could be read, so the split stood on the committed file alone; see the plan step's log, and once the API answers again use "Re-run all jobs"`);
  const out =
    `shards=${JSON.stringify(shards)}\nshard-count=${shards.length}\ntimings=${JSON.stringify(timings)}\n` +
    `stable=${JSON.stringify(stable)}\nsplit-problems=${JSON.stringify(problems)}\n`;
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, out);
  process.stdout.write(out);
} else if (isInvokedDirectly(process.argv[1], import.meta.url)) {
  const [index, total] = process.argv.slice(2).map(Number);
  // Full paths, not bare names: Playwright reads each argument as a regular
  // expression against the file path, and `offline.spec.ts` is a prefix of
  // two other specs.
  process.stdout.write(filesForShard(index, total).map((f) => `tests/e2e/${f}`).join(" "));
}
