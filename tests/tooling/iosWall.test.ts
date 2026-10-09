import { test } from "node:test";
import assert from "node:assert/strict";
import { overBudget, wallSeconds, BUDGET_S } from "../../tools/ci/ios-wall.mjs";

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
  assert.equal(wallSeconds(jobs, GATE), 15 * 60 + 43);
});

test("a job with no start or end time is red, never left out", () => {
  const jobs = [job("Restore the app and bundle its JS", at(0), at(1)), job("flows (lobby)", null, null), job(GATE, at(2), null)];
  assert.throws(() => wallSeconds(jobs, GATE), /flows \(lobby\)/);
});

test("a run listing nothing but the gate is red", () => {
  assert.throws(() => wallSeconds([job(GATE, at(0), null)], GATE), /no job but/);
  assert.throws(() => wallSeconds([job("Restore the app and bundle its JS", at(0), at(1))], GATE), /no job named/);
});

test("the budget is over only past its last second", () => {
  assert.equal(overBudget(BUDGET_S), false);
  assert.equal(overBudget(BUDGET_S + 1), true);
});
