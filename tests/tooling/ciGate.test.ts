import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { gateVerdict, run } from "../../tools/ci/gate.mjs";

type Job = { name?: string; if?: string; needs?: string | string[]; steps?: { run?: string; env?: Record<string, string> }[] };
const root = path.resolve(import.meta.dirname, "..", "..");
const jobs = parse(readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8")).jobs as Record<string, Job>;
const gate = jobs["ci-gate"];
const needs = (job: Job) => [job?.needs ?? []].flat();

test("CI gate needs every other job, Timing budget included", () => {
  assert.equal(gate?.name, "CI gate");
  assert.ok("timing-budget" in jobs);
  assert.deepEqual(needs(gate).sort(), Object.keys(jobs).filter((j) => j !== "ci-gate").sort());
});

// A required check that is skipped reports success, so the gate itself must never be skippable.
test("CI gate runs whatever its needs concluded, and judges them all", () => {
  assert.equal(String(gate.if).trim(), "always()");
  const step = gate.steps?.find((s) => /node tools\/ci\/gate\.mjs/.test(s.run ?? ""));
  assert.match(String(step?.env?.NEEDS), /^\$\{\{\s*toJSON\(needs\)\s*\}\}$/);
});

test("Timing budget judges every pull request's run once its shards have reported", () => {
  const budget = jobs["timing-budget"];
  assert.deepEqual(needs(budget).sort(), ["browser", "native"]);
  assert.match(String(budget.if), /!cancelled\(\)/);
  assert.match(String(budget.if), /github\.event_name == 'pull_request'/);
  assert.ok(budget.steps?.some((s) => /node tools\/ci\/budget-gate\.mjs/.test(s.run ?? "")));
});

for (const [results, ok] of [
  [["success", "skipped"], true],
  [["skipped", "skipped"], true],
  [["success", "failure"], false],
  [["success", "cancelled"], false],
  [["success", undefined], false],
  [[], false],
] as const) {
  test(`a gate over ${JSON.stringify(results)} is ${ok ? "green" : "red"}`, () => assert.equal(gateVerdict([...results]).ok, ok));
}

test("the gate's entry point fails closed on what it cannot read", () => {
  const quiet = () => {};
  assert.equal(run({ NEEDS: JSON.stringify({ lint: { result: "success" }, build: { result: "skipped" } }) }, quiet), 0);
  assert.equal(run({ NEEDS: JSON.stringify({ lint: { result: "failure" } }) }, quiet), 1);
  assert.equal(run({}, quiet), 1);
  assert.equal(run({ NEEDS: "not json" }, quiet), 1);
});
