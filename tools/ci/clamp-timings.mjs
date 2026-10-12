// Run by the weekly cron's timings commit only (ci.yml). A spec measured past `RATIO` times its committed
// time keeps the committed time: committed, the slowdown would become the baseline its budget is computed
// from, with nobody reviewing it. The per-run `e2e-timings` artefact keeps the real measurement for shard balance.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { isInvokedDirectly } from "../../scripts/lib/entry.mjs";
import { committedTimings, RATIO } from "./e2e-budget.mjs";

const TIMINGS = path.join(import.meta.dirname, "..", "..", "tests", "e2e", "timings.json");

/**
 * @param {Record<string, number>} measured
 * @param {Record<string, number>} committed
 */
export function clampTimings(measured, committed) {
  /** @type {{ file: string, measured: number, committed: number }[]} */
  const kept = [];
  const timings = Object.fromEntries(
    Object.entries(measured).map(([file, seconds]) => {
      const was = committed[file];
      if (was === undefined || seconds <= was * RATIO) return [file, seconds];
      kept.push({ file, measured: seconds, committed: was });
      return [file, was];
    })
  );
  return { timings, kept };
}

if (isInvokedDirectly(process.argv[1], import.meta.url)) {
  const { timings, kept } = clampTimings(JSON.parse(readFileSync(TIMINGS, "utf8")), committedTimings());
  writeFileSync(TIMINGS, `${JSON.stringify(timings, null, 2)}\n`);
  for (const { file, measured, committed } of kept) {
    process.stdout.write(
      `::warning::${file} measured ${measured}s, past ${RATIO}× its committed ${committed}s; tests/e2e/timings.json keeps ${committed}s. Make it fast again, or commit the new time in a reviewed pull request.\n`
    );
  }
}
