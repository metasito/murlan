// Fails ios.yml's gate when the run's attempt, first job start to last job end, took longer than the owner's
// budget for a device run (#1405), read from the run's own jobs API rather than from any figure in prose.

import { execFileSync } from "node:child_process";
import { isInvokedDirectly } from "../../scripts/lib/entry.mjs";

export const BUDGET_S = 15 * 60;

/** @param {number} seconds */
export const overBudget = (seconds) => seconds > BUDGET_S;

/**
 * @param {{ name: string, started_at: string | null, completed_at: string | null }[]} jobs
 * @param {string} gate the job doing the reading, still running, so it has no end yet
 * @param {string} attemptStart the run's `run_started_at`, which a re-run resets; a job a re-run
 *   carries over is listed under the new attempt with its old times, so only this tells them apart
 */
export function wallSeconds(jobs, gate, attemptStart) {
  if (!jobs.some((j) => j.name === gate)) throw new Error(`the run has no job named "${gate}"`);
  const others = jobs.filter((j) => j.name !== gate);
  const untimed = others.filter((j) => !j.started_at || !j.completed_at).map((j) => j.name);
  if (untimed.length) throw new Error(`no start or end time for: ${untimed.join(", ")}`);
  const timed = others.filter((j) => Date.parse(j.started_at) >= Date.parse(attemptStart));
  if (timed.length === 0) throw new Error(`the run lists no job of this attempt but "${gate}"`);
  const first = Math.min(...timed.map((j) => Date.parse(j.started_at)));
  const last = Math.max(...timed.map((j) => Date.parse(j.completed_at)));
  return (last - first) / 1000;
}

/**
 * @param {string} gate
 * @param {{ GITHUB_REPOSITORY?: string, GITHUB_RUN_ID?: string }} env
 * @param {(route: string) => string} ghApi
 * @returns {number} the exit code
 */
export function run(gate, env, ghApi, log = console.log) {
  const runRoute = `repos/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`;
  const { run_started_at } = JSON.parse(ghApi(runRoute));
  const { jobs } = JSON.parse(ghApi(`${runRoute}/jobs?filter=latest&per_page=100`));
  const wall = wallSeconds(jobs, gate, run_started_at);
  for (const j of jobs) log(`${j.name}: ${j.started_at} to ${j.completed_at ?? "running"}`);
  log(`The run took ${wall} s of a ${BUDGET_S} s budget.`);
  if (!overBudget(wall)) return 0;
  log(`::error::The device run took ${wall} s, over its ${BUDGET_S} s budget.`);
  return 1;
}

if (isInvokedDirectly(process.argv[1], import.meta.url)) {
  process.exitCode = run(process.argv[2], process.env, (route) => execFileSync("gh", ["api", route], { encoding: "utf8" }));
}
