// tests/androidFlowMarker.test.ts — maestro.yml retries a failed Android run only
// when the emulator never got as far as the flows, and the only thing that tells
// those apart is a marker file the action's script writes. Everything before that
// line is the environment coming up, and retryable; everything after it is a
// result about the branch. A step inserted on the wrong side of it silently
// reclassifies a whole category of failure — an environment wedge announced as a
// verdict on the diff, or a genuine red retried at twice the cost (#186).
//
// Read as text rather than parsed: no YAML parser is a dependency of this project,
// and every claim below is about which line comes before which, which is the level
// the file is actually edited at.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel: string): string {
  return readFileSync(path.join(repoRoot, rel), "utf8");
}

const ACTION = ".github/actions/drive-android-flows/action.yml";
const WORKFLOW = ".github/workflows/maestro.yml";

/** The action's `script:` block, comments and blank lines dropped. */
function scriptLines(): string[] {
  const src = read(ACTION);
  const start = src.indexOf("script: |");
  assert.notEqual(start, -1, "the action no longer carries a script block");
  return src
    .slice(start)
    .split("\n")
    .slice(1)
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("#"));
}

describe("the Android flow marker", () => {
  const lines = scriptLines();

  test("is the last thing the script does before running the flows", () => {
    const marker = lines.findIndex((l) => l.includes("app-launched"));
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

  test("the device coming up and the app launching are two boundaries, in that order", () => {
    // One marker cannot say both. A device that came up and an app that then
    // died within five seconds is neither the runner failing to arrive nor a
    // verdict on the diff, and reporting it as either is what #647 was.
    const booted = lines.findIndex((l) => l.includes("emulator-booted"));
    const launched = lines.findIndex((l) => l.includes("app-launched"));
    assert.notEqual(booted, -1, "nothing marks the device coming up any more");
    assert.ok(
      booted < launched,
      "the app-launch marker must come after the device one, or a device that never " +
        "arrived would be reported as an app that failed to launch",
    );
    assert.ok(
      lines.slice(booted + 1, launched).some((l) => l.includes("am start")),
      "nothing between the two markers launches the app, so the second proves nothing",
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

    for (const loop of lines.filter((l) => l.includes("until "))) {
      assert.match(loop, /\bexit 1\b/, `unbounded poll loop: ${loop}`);
    }
  });
});

describe("maestro.yml reads that marker", () => {
  const src = read(WORKFLOW);

  test("the retry fires only when the flows never started", () => {
    const retry = src.indexOf("id: retry");
    assert.notEqual(retry, -1, "the retry step is gone");
    const block = src.slice(src.lastIndexOf("- name:", retry), retry + 200);
    assert.match(block, /steps\.kind\.outputs\.started == 'false'/);
  });

  test("it tells three states apart, and retries the two it can", () => {
    const kind = src.slice(src.indexOf("id: kind"), src.indexOf("id: retry"));
    assert.match(kind, /app-launched/, "the app-launch state is not distinguished at all");
    assert.match(kind, /emulator-booted/, "the device state is not distinguished at all");
    // `started=true` is what withholds the retry, so exactly one branch may set
    // it: the one where the app actually launched.
    assert.equal(
      (kind.match(/started=true/g) ?? []).length,
      1,
      "more than one state withholds the retry",
    );
    const launched = kind.indexOf("app-launched");
    assert.ok(
      launched < kind.indexOf("started=true"),
      "the retry is withheld before the app-launch marker is read",
    );
  });

  test("the verdict names the app launch rather than blaming the branch for it", () => {
    const verdict = src.slice(src.indexOf("The run's real verdict"));
    const blame = verdict.indexOf("result about the diff");
    const launch = verdict.indexOf("app-launched");
    assert.notEqual(launch, -1, "the verdict cannot see whether the app ever launched");
    assert.ok(
      launch < blame,
      "the diff is blamed before the app launch is checked, which is the defect itself",
    );
  });

  test("the verdict is stated before the steps whose `if: failure()` uploads the artefacts", () => {
    // The step that decides, not the step that classifies: both mention #186, and
    // only this one reads the retry's outcome.
    const verdict = src.indexOf("steps.retry.outcome");
    // A real key, not the prose about it: the comment above the verdict step quotes
    // `if: failure()` verbatim, and matching that would put the artefacts first.
    const artefacts = src.search(/^ *if: failure\(\)/m);
    assert.notEqual(verdict, -1, "no step states the run's verdict");
    assert.notEqual(artefacts, -1, "nothing uploads the artefacts any more");
    assert.ok(
      verdict < artefacts,
      "continue-on-error means the job has no verdict of its own; stating it after the " +
        "artefact steps leaves them nothing to trigger on",
    );
  });

  test("a run whose app died says so itself", () => {
    // Without this the only record is a tombstone in an artefact, and the step
    // that failed is a step later than the one that broke (#629).
    assert.match(src, /grep -rl ">>> host\.exp\.exponent"/);
    assert.match(
      src,
      /Say if the app died[\s\S]{0,80}if: always\(\)/,
      "gating this on failure() hides a crash that did not manage to fail the run",
    );
  });

  test("no grep in that step can kill it before it warns", () => {
    // It runs under `bash -e`, where a grep matching nothing exits non-zero. A
    // step that dies there emits no warning at all — the exact failure it exists
    // to prevent, committed by its own implementation, and only on the path a
    // runner has never executed.
    const step = src.slice(src.indexOf("id: crash"), src.indexOf("Collect Metro's log"));
    const commands = step
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.includes("grep") && !l.startsWith("#"));
    assert.ok(commands.length > 0, "the step no longer looks for a tombstone at all");
    for (const line of commands) {
      assert.ok(
        line.includes("|| true") || line.includes("|| echo") || /\|\s*head/.test(line),
        `a grep whose failure is not absorbed: ${line}`,
      );
    }
  });

  test("a green run carrying a tombstone still uploads what the warning points at", () => {
    // `always()` exists for the crash that did not fail the run. If the artefact
    // steps stay on failure() alone, that warning names a path nobody can reach.
    const uploads = [...src.matchAll(/^ *if: failure\(\).*$/gm)].map((m) => m[0]);
    assert.ok(uploads.length >= 2, "the Metro copy and the artefact upload");
    for (const gate of uploads) {
      assert.match(
        gate,
        /steps\.crash\.outputs\.found == 'true'/,
        `this step does not run for a crash on a green run: ${gate.trim()}`,
      );
    }
  });

  test("both invocations of the action stay in step", () => {
    const invocations = [...src.matchAll(/uses: \.\/\.github\/actions\/drive-android-flows\n(.*?)(?=\n *- name:|\n *#|\n\n)/gs)];
    assert.equal(invocations.length, 2, "the first attempt and its retry");
    assert.equal(
      invocations[0][1].trim(),
      invocations[1][1].trim(),
      "a retry configured differently from the first attempt is not a retry",
    );
  });
});
