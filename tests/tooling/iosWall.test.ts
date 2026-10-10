import { test } from "node:test";
import assert from "node:assert/strict";
import { overBudget, run, wallSeconds, BUDGET_S } from "../../tools/ci/ios-wall.mjs";

const GATE = "Drive the app on a real iOS simulator";
const at = (minute: number, second = 0) => `2026-10-08T04:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}Z`;
const job = (name: string, started_at: string | null, completed_at: string | null) => ({ name, started_at, completed_at });

test("the wall runs from the first job's start to the last job's end, the gate's own excluded", () => {
  const jobs = [
    job("Restore the app and bundle its JS", at(0), at(1, 24)),
    job("flows (rematch-prompt)", at(1, 30), at(15, 43)),
    job("flows (offline-game)", at(1, 31), at(12)),
    job(GATE, at(15, 50), null),
  ];
  assert.equal(wallSeconds(jobs, GATE, at(0)), 15 * 60 + 43);
});

test("on a re-run the wall spans only this attempt's jobs, not the ones carried over from the last", () => {
  const jobs = [
    job("Restore the app and bundle its JS", at(0), at(1, 24)),
    job("flows (offline-game)", at(1, 31), at(12)),
    job("flows (rematch-prompt)", at(40, 10), at(52)),
    job(GATE, at(52, 5), null),
  ];
  assert.equal(wallSeconds(jobs, GATE, at(40)), 11 * 60 + 50);
});

test("a re-run of the gate alone has nothing of its own attempt to time, and stays red", () => {
  const jobs = [job("Restore the app and bundle its JS", at(0), at(1)), job("flows (lobby)", at(1), at(20)), job(GATE, at(40, 5), null)];
  assert.throws(() => wallSeconds(jobs, GATE, at(40)), /no job of this attempt/);
});

test("a job with no start or end time is red, never left out", () => {
  const jobs = [job("Restore the app and bundle its JS", at(0), at(1)), job("flows (lobby)", null, null), job(GATE, at(2), null)];
  assert.throws(() => wallSeconds(jobs, GATE, at(0)), /flows \(lobby\)/);
});

test("a run listing nothing but the gate is red", () => {
  assert.throws(() => wallSeconds([job(GATE, at(0), null)], GATE, at(0)), /no job of this attempt/);
  assert.throws(() => wallSeconds([job("Restore the app and bundle its JS", at(0), at(1))], GATE, at(0)), /no job named/);
});

test("the budget is over only past its last second", () => {
  assert.equal(overBudget(BUDGET_S), false);
  assert.equal(overBudget(BUDGET_S + 1), true);
});

test("the gate reads its own attempt's start and latest jobs, and exits red only past the budget", () => {
  const env = { GITHUB_REPOSITORY: "metasito/murlan", GITHUB_RUN_ID: "37769925676" };
  const runFor = (endSecond: number) => {
    const routes: string[] = [];
    const lines: string[] = [];
    const end = new Date(Date.parse(at(20)) + endSecond * 1000).toISOString();
    const jobs = [
      job("flows (lobby)", at(0), at(1)),
      job("Restore the app and bundle its JS", at(20), at(21)),
      job("flows (smoke)", at(21), end),
      job(GATE, at(20), null),
    ];
    const api = (route: string) => (routes.push(route), JSON.stringify(route.includes("/jobs") ? { jobs } : { run_started_at: at(20) }));
    const code = run(GATE, env, api, (line: string) => lines.push(line));
    return { code, routes, lines };
  };
  const over = runFor(BUDGET_S + 1);
  assert.deepEqual(over.routes, [
    "repos/metasito/murlan/actions/runs/37769925676",
    "repos/metasito/murlan/actions/runs/37769925676/jobs?filter=latest&per_page=100",
  ]);
  assert.equal(over.code, 1);
  assert.match(over.lines.at(-1)!, /^::error::/);
  assert.equal(runFor(BUDGET_S).code, 0);
});
