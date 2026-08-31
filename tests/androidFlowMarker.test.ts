// tests/androidFlowMarker.test.ts — maestro.yml retries a failed Android run only
// when the emulator never got as far as the flows, and the only thing that tells
// those apart is a marker file the action's script writes. Everything before that
// line is the environment coming up, and retryable; everything after it is a
// result about the branch. A step inserted on the wrong side of it silently
// reclassifies a whole category of failure — an environment wedge announced as a
// verdict on the diff, or a genuine red retried at twice the cost (#186).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import yaml from "js-yaml";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function load(rel: string): any {
  return yaml.load(readFileSync(path.join(repoRoot, rel), "utf8"));
}

const MARKER = "emulator-booted";

describe("the Android flow marker", () => {
  const action = load(".github/actions/drive-android-flows/action.yml");
  const script: string = action.runs.steps[0].with.script;
  const lines = script
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("#"));

  test("is the last thing the script does before running the flows", () => {
    const marker = lines.findIndex((l) => l.includes(MARKER));
    const flows = lines.findIndex((l) => l.startsWith("maestro test"));
    assert.notEqual(marker, -1, "the script no longer writes the marker at all");
    assert.notEqual(flows, -1, "the script no longer runs the flows");
    assert.equal(
      marker + 1,
      flows,
      "a step was inserted between the marker and the flows: if it can fail on the " +
        "runner it belongs above the marker, so the failure retries instead of being " +
        "reported as a result about the branch",
    );
  });

  test("every wait before it is bounded, so a wedge fails rather than hanging", () => {
    // A job that overruns timeout-minutes is cancelled, not failed. `failure()` is
    // then false, so the verdict step and both artefact uploads never run — in
    // exactly the case they exist to explain.
    const unbounded = lines.filter(
      (l) => l.includes("wait-for-device") && !l.startsWith("timeout "),
    );
    assert.deepEqual(unbounded, [], "an adb wait with no timeout can hang the job to cancellation");

    const loops = lines.filter((l) => l.startsWith("until ") || l.includes("; until "));
    for (const loop of loops) {
      assert.match(loop, /\bexit 1\b/, `unbounded poll loop: ${loop}`);
    }
  });
});

describe("maestro.yml reads that marker", () => {
  const workflow = load(".github/workflows/maestro.yml");
  const steps: any[] = workflow.jobs.android.steps;

  test("the retry fires only when the flows never started", () => {
    const retry = steps.find((s) => s.id === "retry");
    assert.ok(retry, "the retry step is gone");
    assert.match(retry.if, /steps\.kind\.outputs\.started == 'false'/);
  });

  test("the verdict is stated before the steps whose `if: failure()` uploads the artefacts", () => {
    // The step that decides, not the step that classifies: both mention #186,
    // and only this one reads the retry's outcome and can exit 0.
    const verdict = steps.findIndex(
      (s) => typeof s.run === "string" && s.run.includes("steps.retry.outcome"),
    );
    const artefacts = steps.findIndex((s) => s.if === "failure()");
    assert.notEqual(verdict, -1, "no step states the run's verdict");
    assert.equal(steps[verdict].continueOnError, undefined, "the verdict cannot itself be waived");
    assert.ok(
      verdict < artefacts,
      "continue-on-error means the job has no verdict of its own; stating it after the " +
        "artefact steps leaves them nothing to trigger on",
    );
  });

  test("both invocations of the action stay in step", () => {
    const invocations = steps.filter((s) => s.uses === "./.github/actions/drive-android-flows");
    assert.equal(invocations.length, 2, "the first attempt and its retry");
    assert.deepEqual(
      invocations[0].with,
      invocations[1].with,
      "a retry configured differently from the first attempt is not a retry",
    );
  });
});
