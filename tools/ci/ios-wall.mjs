// Fails ios.yml's gate when the run, first job start to last job end, took longer than the owner's
// budget for a device run (#1405), read from the run's own jobs API rather than from any figure in prose.

import { execFileSync } from "node:child_process";
import { isInvokedDirectly } from "../../scripts/lib/entry.mjs";

export const BUDGET_S = 15 * 60;

/** @param {number} seconds */
export const overBudget = (seconds) => seconds > BUDGET_S;

/**
 * @param {{ name: string, started_at: string | null, completed_at: string | null }[]} jobs
 * @param {string} gate the job doing the reading, still running, so it has no end yet
 */
export function wallSeconds(jobs, gate) {
  if (!jobs.some((j) => j.name === gate)) throw new Error(`the run has no job named "${gate}"`);
  const timed = jobs.filter((j) => j.name !== gate);
  if (timed.length === 0) throw new Error(`the run lists no job but "${gate}"`);
  const untimed = timed.filter((j) => !j.started_at || !j.completed_at).map((j) => j.name);
  if (untimed.length) throw new Error(`no start or end time for: ${untimed.join(", ")}`);
  const first = Math.min(...timed.map((j) => Date.parse(j.started_at)));
  const last = Math.max(...timed.map((j) => Date.parse(j.completed_at)));
  return (last - first) / 1000;
}

if (isInvokedDirectly(process.argv[1], import.meta.url)) {
  const gate = process.argv[2];
  const { GITHUB_REPOSITORY, GITHUB_RUN_ID } = process.env;
  const route = `repos/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}/jobs?filter=latest&per_page=100`;
  const { jobs } = JSON.parse(execFileSync("gh", ["api", route], { encoding: "utf8" }));
  const wall = wallSeconds(jobs, gate);
  for (const j of jobs) console.log(`${j.name}: ${j.started_at} to ${j.completed_at ?? "running"}`);
  console.log(`The run took ${wall} s of a ${BUDGET_S} s budget.`);
  if (overBudget(wall)) {
    console.log(`::error::The device run took ${wall} s, over its ${BUDGET_S} s budget.`);
    process.exit(1);
  }
}
