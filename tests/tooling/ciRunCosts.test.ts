import { test } from "node:test";
import assert from "node:assert/strict";
import { runCosts } from "../../tools/ci/ci-run-costs.mjs";

const at = (s: number) => new Date(Date.UTC(2026, 9, 8, 12, 0, 0) + s * 1000).toISOString();
const job = (name: string, start: number, end: number | null, conclusion = "success") => ({
  name,
  conclusion: end === null ? null : conclusion,
  started_at: at(start),
  completed_at: end === null ? null : at(end),
});

const jobs = [
  job("Does this change need the suite?", 0, 13),
  job("Secret scan", 0, 70),
  job("Native tests", 16, 280),
  job("Android compiles", 13, 13, "skipped"),
  job("Browser tests 1/2", 16, 216),
  job("Browser tests 2/2", 16, 250),
  job("Browser test report", 253, 290),
];
const split = { "a.spec.ts": 100, "b.spec.ts": 100, "c.spec.ts": 50, "d.spec.ts": 50 };
const measured = { "a.spec.ts": 110, "b.spec.ts": 120, "c.spec.ts": 50, "d.spec.ts": 60 };
const files = Object.keys(split);

test("prices a run from its own job timings", () => {
  const costs = runCosts({ run: 7, jobs, split, measured, files });

  assert.deepEqual(costs.shards, [
    { shard: 1, plannedSeconds: 150, specSeconds: 160, wallSeconds: 203 },
    { shard: 2, plannedSeconds: 150, specSeconds: 180, wallSeconds: 237 },
  ]);
  assert.equal(costs.aroundShardsSeconds, 53);
  assert.equal(costs.shardOverheadSeconds, 50);
  assert.equal(costs.shardNoise, 1.1);
  assert.deepEqual(costs.otherJobsEndSeconds, { "Native tests": 280, "Secret scan": 70 });
});

test("prices each step of the jobs on the critical path", () => {
  const step = (name: string, start: number, end: number | null) => ({ name, started_at: start < 0 ? null : at(start), completed_at: end === null ? null : at(end) });
  const withSteps = jobs.map((j) => {
    if (j.name === "Does this change need the suite?") return { ...j, steps: [step("Plan", 0, 13)] };
    if (j.name === "Browser tests 2/2") return { ...j, steps: [step("Set up", 16, 66), step("Specs", 66, 250)] };
    if (j.name === "Browser test report") return { ...j, completed_at: null, steps: [step("Merge", 253, 270), step("Price", 270, null), step("Upload", -1, null)] };
    return j;
  });
  const costs = runCosts({ run: 7, jobs: withSteps, split, measured, files, now: at(275) });

  assert.deepEqual(costs.criticalPath, [
    { job: "Does this change need the suite?", steps: { Plan: 13 } },
    { job: "Browser tests 2/2", steps: { "Set up": 50, Specs: 184 } },
    { job: "Browser test report", steps: { Merge: 17, Price: 5 } },
  ]);
});

test("the model it feeds reproduces the run it measured", () => {
  const costs = runCosts({ run: 7, jobs, split, measured, files });
  const fairShare = (110 + 120 + 50 + 60) / costs.shards.length;
  const predicted = costs.aroundShardsSeconds + costs.shardOverheadSeconds + costs.shardNoise * fairShare;

  assert.ok(predicted >= 290, `the model predicts ${predicted}s for a run that took 290s`);
});

test("a report job still running ends now, and any other job still running has no end yet", () => {
  const running = jobs.map((j) => (j.name === "Browser test report" || j.name === "Native tests" ? job(j.name, j.name.length, null) : j));
  const costs = runCosts({ run: 7, jobs: running, split, measured, files, now: at(300) });

  assert.equal(costs.aroundShardsSeconds, 63);
  assert.equal(costs.otherJobsEndSeconds["Native tests"], null);
});

test("refuses a run whose shards did not all pass", () => {
  const red = jobs.map((j) => (j.name === "Browser tests 2/2" ? { ...j, conclusion: "cancelled" } : j));

  assert.throws(() => runCosts({ run: 7, jobs: red, split, measured, files }), /Browser tests 2\/2 .*cancelled/);
});

test("refuses a re-run, whose carried-over jobs keep the first attempt's clock", () => {
  const rerun = jobs.map((j) => ({ ...j, run_attempt: j.name === "Browser test report" ? 2 : 1 }));

  assert.throws(() => runCosts({ run: 7, jobs: rerun, split, measured, files }), /run 7 spans attempts 1, 2/);
});

test("refuses a run missing a shard the matrix had", () => {
  const short = jobs.filter((j) => j.name !== "Browser tests 1/2");

  assert.throws(() => runCosts({ run: 7, jobs: short, split, measured, files }), /1 of 2 shards/);
});
