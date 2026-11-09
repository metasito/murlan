import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parse } from "yaml";
import * as budgetGate from "../../tools/ci/budget-gate.mjs";
import { gateVerdict, run } from "../../tools/ci/gate.mjs";

type Step = { name?: string; id?: string; uses?: string; run?: string; env?: Record<string, string> };
type Job = { name?: string; if?: string; needs?: string | string[]; steps?: Step[] };
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

// ciVerdict reads a failure of the reading step as infrastructure and of the next as the diff's red,
// so which step fails is the contract: budget-gate exits 2 when the lists never arrived, 1 on a finding.
test("Timing budget fails its reading step on unread lists and its judging step on a finding, never neither", () => {
  assert.ok(budgetGate.UNREAD_STEP, "budget-gate.mjs names no reading step");
  const steps = jobs["timing-budget"].steps ?? [];
  const at = steps.findIndex((s) => s.name === budgetGate.UNREAD_STEP);
  assert.ok(at >= 0, `no step named ${budgetGate.UNREAD_STEP}`);
  const [read, judge] = [steps[at]!, steps[at + 1]];
  assert.ok(judge?.run, "no judging step after the reading one");
  assert.ok(read.run?.includes("node tools/ci/budget-gate.mjs"));
  const output = path.join(mkdtempSync(path.join(tmpdir(), "budget-step-")), "out");
  const bash = (script: string, env: Record<string, string>) =>
    spawnSync("bash", ["-e", "-c", script], { env: { ...process.env, GITHUB_OUTPUT: output, ...env }, encoding: "utf8" }).status;
  const outputOf = () => /^(\w+)=(.*)$/m.exec(readFileSync(output, "utf8"));
  const judged = () => {
    const [, key, value] = outputOf() ?? [];
    const env = Object.fromEntries(Object.entries(judge.env ?? {}).map(([k, v]) => [k, v === `\${{ steps.${read.id}.outputs.${key} }}` ? value! : ""]));
    return bash(judge.run!, env);
  };
  for (const [code, readOk, judgeOk] of [[0, true, true], [1, true, false], [2, false, null], [3, true, false]] as const) {
    writeFileSync(output, "");
    assert.equal(bash(read.run!.replace("node tools/ci/budget-gate.mjs", `(exit ${code})`), {}) === 0, readOk, `exit ${code}: read`);
    if (judgeOk !== null) assert.equal(judged() === 0, judgeOk, `exit ${code}: judge`);
  }
  writeFileSync(output, "");
  assert.notEqual(judged(), 0, "a judging step with no output from the reading one is green");
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

test("a daily schedule runs the whole suite on main, and only the weekly one compiles devices and commits timings", () => {
  const raw = readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8");
  const crons = ((parse(raw).on.schedule ?? []) as { cron: string }[]).map((s) => s.cron);
  assert.equal(crons.length, 2, "one weekly cron, one daily");
  const [weekly, daily] = [crons.find((c) => /\* 1$/.test(c)), crons.find((c) => /\* \*$/.test(c))];
  assert.ok(weekly && daily, "a weekly and a daily cron");
  assert.doesNotMatch(raw, /github\.event_name == 'schedule'/, "a daily run would compile devices and commit timings");
  assert.equal(raw.match(new RegExp(`github\\.event\\.schedule == '${weekly.replace(/\*/g, "\\*")}'`, "g"))?.length, 3);
});

type UploadStep = Step & { uses?: string; "continue-on-error"?: boolean; if?: string; with?: { name?: string } };

/** Each upload that is not half of a pair: a first attempt with no unguarded retry straight after, or a lone attempt. */
export function unretriedUploads(steps: UploadStep[]): string[] {
  const upload = (s?: UploadStep) => /^actions\/upload-artifact@/.test(s?.uses ?? "");
  const retries = (first: UploadStep | undefined, s: UploadStep | undefined) =>
    upload(first) && first!["continue-on-error"] === true && !!first!.id && upload(s) && s!.with?.name === first!.with?.name && !s!["continue-on-error"] && String(s!.if).includes(`steps.${first!.id}.outcome == 'failure'`);
  const bad: string[] = [];
  steps.forEach((s, i) => {
    if (!upload(s)) return;
    const label = s.with?.name ?? `step ${i}`;
    if (s["continue-on-error"] === true) {
      if (!retries(s, steps[i + 1])) bad.push(`${label}: continue-on-error with no unguarded retry of the same artifact straight after`);
    } else if (!retries(steps[i - 1], s)) bad.push(`${label}: a single attempt, so a dropped connection reds the job after the suite passed`);
  });
  return bad;
}

test("every artifact upload is tried twice: a guarded first attempt, then a retry that fails the job", () => {
  const all = Object.values(jobs).flatMap((j) => (j.steps ?? []) as UploadStep[]);
  assert.ok(all.filter((s) => /^actions\/upload-artifact@/.test(s.uses ?? "")).length >= 22, "the scan finds the uploads it guards");
  for (const job of Object.values(jobs)) assert.deepEqual(unretriedUploads((job.steps ?? []) as UploadStep[]), []);
});

test("an upload with no retry, a retry that may itself fail, and one for another artifact are each red", () => {
  const first = { id: "up", uses: "actions/upload-artifact@x", "continue-on-error": true, with: { name: "a" } };
  const retry = { if: "${{ !cancelled() && steps.up.outcome == 'failure' }}", uses: "actions/upload-artifact@x", with: { name: "a" } };
  assert.deepEqual(unretriedUploads([first, retry]), []);
  assert.equal(unretriedUploads([{ ...first, "continue-on-error": undefined }]).length, 1);
  assert.equal(unretriedUploads([retry]).length, 1);
  assert.equal(unretriedUploads([first]).length, 1);
  assert.equal(unretriedUploads([first, { ...retry, "continue-on-error": true }]).length, 2);
  assert.equal(unretriedUploads([first, { ...retry, with: { name: "b" } }]).length, 2);
  assert.equal(unretriedUploads([first, { ...retry, if: "${{ always() }}" }]).length, 2);
});
