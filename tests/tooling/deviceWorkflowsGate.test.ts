import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";

const root = path.resolve(import.meta.dirname, "..", "..");
type Step = { name?: string; run?: string; env?: Record<string, string> };
type Job = { needs?: string | string[]; if?: string; steps?: Step[] };
const bare = (expr: unknown) => String(expr ?? "").replace(/^\$\{\{\s*([\s\S]*?)\s*\}\}$/, "$1").replace(/\s+/g, " ").trim();
const needsOf = (job: Job) => [job.needs ?? []].flat();
// `bash -e`, as a `run:` step runs on ubuntu-latest.
const exitOf = (script: string, env: Record<string, string>) =>
  spawnSync("bash", ["-e", "-c", script], { env: { ...process.env, ...env }, encoding: "utf8" }).status;

for (const wf of [".github/workflows/ios.yml", ".github/workflows/maestro.yml"]) {
  describe(`${wf} runs a device only on attempt 1 of a schedule or a ticket's own branch`, () => {
    const jobs = parse(readFileSync(path.join(root, wf), "utf8")).jobs as Record<string, Job>;
    const verdict = Object.keys(jobs).find((name) => bare(jobs[name]!.if) === "always()");
    const devices = Object.keys(jobs).filter((name) => name !== "gate" && name !== verdict);

    test("the gate job passes a schedule and a dispatch on agent/<n>-… or claude/<n>-…, and nothing else", () => {
      const step = jobs.gate?.steps?.find((s) => s.env?.REF);
      assert.ok(step?.run, "no gate job reading the ref");
      assert.equal(bare(step.env!.REF), "github.ref_name");
      assert.equal(bare(step.env!.EVENT), "github.event_name");
      assert.equal(jobs.gate!.if, undefined);
      const gate = (EVENT: string, REF: string) => exitOf(step.run!, { EVENT, REF });
      assert.equal(gate("schedule", "main"), 0);
      for (const ref of ["agent/1529-push-own-ticket", "claude/1259-lantern"]) assert.equal(gate("workflow_dispatch", ref), 0, ref);
      for (const ref of ["main", "agent/1199", "claude/1259", "claude/foo", "claude/loop-lean-2-guards", "side/1195-x", "x/agent/1-y", "agent/12a-x"]) {
        assert.notEqual(gate("workflow_dispatch", ref), 0, ref);
      }
    });

    test("every device job waits on the gate and runs only on attempt 1", () => {
      assert.ok(devices.length > 0);
      for (const name of devices) {
        assert.ok(needsOf(jobs[name]!).includes("gate"), `${name} does not wait on the gate`);
        assert.equal(bare(jobs[name]!.if), "github.run_attempt == 1", name);
      }
    });

    // A rerun of failed jobs reruns them and their dependents under the new attempt and carries every
    // passed job over: a device job skipped there leaves the run green unless a job that always runs
    // after it says otherwise.
    test("the verdict job always runs after every job and is red on any attempt past 1 or any job not passed", () => {
      assert.ok(verdict, "no job runs under always()");
      assert.deepEqual([...needsOf(jobs[verdict]!)].sort(), ["gate", ...devices].sort());
      const step = jobs[verdict]!.steps?.find((s) => s.env?.RESULTS);
      assert.ok(step?.run, "no step reads the needs' results");
      const needs = needsOf(jobs[verdict]!);
      assert.equal(step.env!.RESULTS, needs.map((n) => `\${{ needs.${n}.result }}`).join(" "));
      assert.equal(bare(step.env!.ATTEMPT), "github.run_attempt");
      const judge = (ATTEMPT: string, results: string[]) => exitOf(step.run!, { ATTEMPT, RESULTS: results.join(" ") });
      const passed = needs.map(() => "success");
      assert.equal(judge("1", passed), 0);
      assert.notEqual(judge("2", passed), 0, "a rerun carrying every pass over is green");
      for (let i = 0; i < needs.length; i++) {
        for (const result of ["skipped", "failure", "cancelled"]) {
          assert.notEqual(judge("1", passed.map((r, j) => (j === i ? result : r))), 0, `${needs[i]} ${result}`);
        }
      }
    });
  });
}
