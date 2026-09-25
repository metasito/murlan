// tests/tooling/androidFlowMarker.test.ts — maestro.yml retries a failed Android run only
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
import { actionScriptLines, markerIndex } from "../helpers/androidAction.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function read(rel: string): string {
  return readFileSync(path.join(repoRoot, rel), "utf8");
}

const WORKFLOW = ".github/workflows/maestro.yml";
const ACTION = ".github/actions/drive-android-flows/action.yml";

/**
 * Every `::error::`/`::warning::` a run can actually print, from both files. The
 * leading `[^#\n]*` is what drops the comments that quote one: a claim about
 * what a run says to its reader must not be answerable by prose about it.
 */
function annotations(): string[] {
  return [WORKFLOW, ACTION]
    .flatMap((f) => [...read(f).matchAll(/^[^#\n]*::(?:error|warning)::.*$/gm)])
    .map((m) => m[0].trim());
}

/** Every `$RUNNER_TEMP` file the script streams a running command into. */
const STREAMED = [
  ...new Set(
    actionScriptLines(repoRoot).flatMap((l) =>
      [...l.matchAll(/>\s*"\$RUNNER_TEMP\/([\w.-]+)"/g)].map((m) => m[1]),
    ),
  ),
];

describe("the Android flow marker", () => {
  const lines = actionScriptLines(repoRoot);

  test("is the last thing the script does before running the flows", () => {
    const marker = markerIndex(lines, "app-launched");
    // Any Maestro invocation: the flags between `maestro` and `test` are the
    // device and the app id, and pinning their spelling here would fail the
    // next time either is added rather than when the ordering breaks.
    const flows = lines.findIndex((l) => /^maestro\b.*\btest\b/.test(l));
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
    const booted = markerIndex(lines, "emulator-booted");
    const launched = markerIndex(lines, "app-launched");
    assert.ok(
      booted < launched,
      "the app-launch marker must come after the device one, or a device that never " +
        "arrived would be reported as an app that failed to launch",
    );
    assert.ok(
      lines.slice(booted + 1, launched).some((l) => /\bam start\b|\bmonkey\b/.test(l)),
      "nothing between the two markers launches the app, so the second proves nothing",
    );
  });

  test("nothing above the device marker touches what this branch built", () => {
    // The whole weight of the verdict's "that is the runner and not this branch"
    // rests on this: the marker is absent for everything above it alike, so one
    // line up there consuming the branch's own build is a bad APK reported as a
    // sick runner.
    // The names come from the build step's own `$GITHUB_ENV` writes, so a third
    // export consumed up there is caught without this test being told about it.
    const exported = [...read(WORKFLOW).matchAll(/echo "(\w+)=[^"]*" >> "\$GITHUB_ENV"/g)].map(
      (m) => m[1],
    );
    assert.ok(exported.length >= 2, "the build no longer exports what it built, or the scan broke");
    const built = new RegExp(`${exported.join("|")}|\\.apk\\b`);
    for (const l of lines.slice(0, markerIndex(lines, "emulator-booted"))) {
      assert.doesNotMatch(
        l,
        built,
        `the verdict calls a failure here the runner's, but this line runs the branch's build: ${l}`,
      );
    }
  });

  test("each attempt clears the markers it is about to write", () => {
    // `$RUNNER_TEMP` outlives an attempt and the action runs twice in one job,
    // so a marker the first attempt wrote would answer for the second — and the
    // verdict would name the wrong cause under the right result.
    const clear = lines.findIndex((l) => l.startsWith("rm -f") && l.includes("emulator-booted"));
    assert.notEqual(clear, -1, "a stale marker from the first attempt is read as the retry's");
    assert.match(lines[clear], /app-launched/, "one marker is cleared and the other is not");
    assert.match(lines[clear], /emulator-lost/, "a device lost on the first attempt is blamed on the retry");
    assert.ok(
      clear < lines.findIndex((l) => l.includes("touch")),
      "the markers are cleared after one of them is written",
    );
  });

  test("the instruments run above the markers, and cannot fail the step", () => {
    // An instrument is not a verdict. A collector that exits non-zero would
    // turn a retryable environment failure into a result about the branch, and
    // one started below `app-launched` would do it on the un-retryable side of
    // the boundary as well.
    const collectors = lines.filter((l) => l.startsWith("nohup"));
    assert.equal(collectors.length, 3, "the logcat stream, the host vitals and the emulator process");
    const launched = markerIndex(lines, "app-launched");
    for (const c of collectors) {
      assert.ok(lines.indexOf(c) < launched, `an instrument starts after the app-launch marker: ${c}`);
      assert.match(c, /&\s*true$/, `an instrument whose failure is not absorbed: ${c}`);
    }
    assert.ok(collectors.some((l) => /adb logcat/.test(l)), "nothing streams the logcat");
    assert.ok(
      collectors.some((l) => /loadavg/.test(l) && /free -m/.test(l)),
      "nothing samples the host's own CPU and memory, which is the only thing that " +
        "tells an exhausted runner apart from a graphics fault",
    );
    assert.ok(
      collectors.some((l) => /ps -eo/.test(l) && /adb devices/.test(l)),
      "nothing samples the emulator process beside the transport, which is the only thing that " +
        "tells a VM that died apart from one still running behind a dead ADB connection",
    );
  });

  test("every wait before it is bounded, so a wedge fails rather than hanging", () => {
    // A job that overruns timeout-minutes is cancelled, not failed. `failure()` is
    // then false, so the verdict step and both artefact uploads never run — in
    // exactly the case they exist to explain.
    // Every shape that blocks on the device, not only the one named
    // `wait-for-device`: the install and the launch wait on it just as hard.
    const unbounded = lines.filter(
      (l) => /wait-for-device|^adb install\b|\bmonkey\b/.test(l) && !l.startsWith("timeout "),
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
    // The retry reads `started == 'false'`, which an unset output also fails. A
    // branch that classifies and then says nothing withholds the retry without
    // meaning to.
    assert.equal(
      (kind.match(/started=false/g) ?? []).length,
      2,
      "a state that neither withholds the retry nor asks for it",
    );
    assert.equal(
      (kind.match(/booted=/g) ?? []).length,
      3,
      "a state that does not record whether the first attempt came up",
    );
    const launched = kind.indexOf("app-launched");
    assert.ok(
      launched < kind.indexOf("started=true"),
      "the retry is withheld before the app-launch marker is read",
    );
  });

  test("no annotation routes a reader to an issue number", () => {
    // A comment may cite a closed issue - the record is still the record. An
    // annotation is a call to act, and nothing in a workflow can tell that the
    // issue behind one has been answered, so every one of these goes on sending
    // the reader of a failed run somewhere nobody is listening.
    const printed = annotations();
    // Both halves of the floor are load-bearing: a regex that matched nothing
    // would pass this test by finding no issue to object to, and one that
    // matched only the file it was written against would answer for both.
    assert.ok(printed.length >= 15, `only ${printed.length} annotations found; the scan is broken`);
    for (const f of [WORKFLOW, ACTION]) {
      assert.ok(
        printed.some((a) => read(f).includes(a)),
        `the scan found nothing in ${f}, so it is answering about one file`,
      );
    }
    for (const a of printed) {
      assert.doesNotMatch(a, /#\d+/, `an annotation naming an issue: ${a}`);
    }
  });

  test("the verdict's 'twice' reads the first attempt's own record", () => {
    // The retry clears both markers before writing them, so afterwards they
    // describe that attempt alone; `kind` ran before it and is the only account
    // of the first.
    const verdict = src.slice(src.indexOf("The run's real verdict"));
    const twice = verdict.search(/::error::[^\n]*twice/);
    assert.notEqual(twice, -1, "no branch of the verdict claims anything happened twice");
    const guard = verdict.slice(verdict.lastIndexOf("if [", twice), twice);
    assert.match(
      guard,
      /steps\.kind\.outputs\.booted\s*\}\}"\s*!=\s*"true"/,
      "the verdict calls a boot failure twice without reading what the first attempt reached",
    );
    assert.match(
      guard,
      /!\s+-f\s+"\$RUNNER_TEMP\/emulator-booted"/,
      "the verdict calls a boot failure twice on a retry whose device did come up",
    );
    assert.doesNotMatch(
      guard,
      /\|\|/,
      "the verdict claims twice on any one of its conditions rather than all of them",
    );
  });

  test("a device lost while the flows ran is not called a result about the diff", () => {
    const flows = actionScriptLines(repoRoot).find((l) => /^maestro\b.*\btest\b/.test(l)) ?? "";
    assert.match(flows, /\|\|[^\n]*adb[^\n]*\|\|\s*touch "\$RUNNER_TEMP\/emulator-lost"/);
    const verdict = src.slice(src.indexOf("The run's real verdict"));
    const lost = verdict.indexOf("emulator-lost");
    assert.ok(lost !== -1 && lost < verdict.indexOf("result about the diff"), "the lost device is read after the blame");
    const said = verdict.slice(lost).match(/::error::[^\n]*/)?.[0] ?? "";
    assert.doesNotMatch(said, /diff/);
  });

  test("the verdict reads its markers narrowest-first", () => {
    // Narrowest condition first: no marker at all, then a device that came up,
    // then an app that launched. Read in any other order the broadest answer
    // arrives first and every failure becomes the diff's, which is the defect
    // itself.
    const verdict = src.slice(src.indexOf("The run's real verdict"));
    const blame = verdict.indexOf("result about the diff");
    const launch = verdict.indexOf("app-launched");
    const booted = verdict.indexOf("emulator-booted");
    assert.notEqual(launch, -1, "the verdict cannot see whether the app ever launched");
    assert.notEqual(booted, -1, "the verdict cannot see whether the device ever came up");
    assert.ok(booted < launch && launch < blame, "the verdict's branches are out of order");
  });

  test("the verdict is stated before the steps whose `if: failure()` uploads the artefacts", () => {
    // The step that decides, not the step that classifies: both read the same
    // markers, and only this one reads the retry's outcome.
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

  test("a green run carrying a tombstone still uploads what the warning points at", () => {
    // `always()` exists for the crash that did not fail the run. If the artefact
    // steps stay on failure() alone, that warning names a path nobody can reach.
    const uploads = [...src.matchAll(/^ *if: failure\(\).*$/gm)].map((m) => m[0]);
    assert.ok(uploads.length >= 1, "nothing uploads the artefacts any more");
    for (const gate of uploads) {
      assert.match(
        gate,
        /steps\.crash\.outputs\.found == 'true'/,
        `this step does not run for a crash on a green run: ${gate.trim()}`,
      );
    }
  });

  test("what the instruments write is what gets uploaded", () => {
    // They are collected outside `~/.maestro/tests` on purpose — they have to
    // outlive the device — so the artefact path has to name them, and a
    // collector whose output nobody uploads is not an instrument. Derived from
    // the script rather than listed: a list is silent about the next one added.
    const upload = src.slice(src.indexOf("name: maestro-debug"), src.indexOf("if-no-files-found"));
    assert.ok(STREAMED.length >= 3, `only ${STREAMED.length} instrument output(s) found; the scan broke`);
    for (const file of STREAMED) {
      assert.ok(upload.includes(file), `${file} is collected and then not uploaded`);
    }
  });

  test("the emulator writes its own output to a file that exists by then and is uploaded", () => {
    // The flag's target is opened without `O_CREAT`, so the creating step has to
    // come before the launch or the VM never boots; and three places have to
    // name one path, which is why all three are read rather than one asserted.
    const action = read(ACTION);
    const told = /-stdouterr-file \$\{\{ runner\.temp \}\}\/([\w.-]+)/.exec(action);
    assert.ok(told, "nothing tells the emulator where to write its own stdout and stderr");
    const file = told[1];
    const created = action.indexOf(`touch "\${{ runner.temp }}/${file}"`);
    assert.notEqual(created, -1, `${file} is never created, so the launcher exits "cannot open"`);
    assert.ok(
      created < action.indexOf("uses: reactivecircus/android-emulator-runner"),
      `${file} is created after the emulator that has to open it`,
    );
    const upload = src.slice(src.indexOf("name: maestro-debug"), src.indexOf("if-no-files-found"));
    assert.ok(upload.includes(file), `${file} is written and then not uploaded`);
  });

  test("the emulator's own files are swept up, and an empty sweep still says so", () => {
    // The VM's stderr is orphaned by the launcher (#1062), so what it leaves on
    // disk is the whole of its own account. A sweep that wrote nothing when it
    // found nothing would be indistinguishable from one that never ran.
    const step = src.slice(src.indexOf("Collect whatever the emulator wrote"), src.indexOf("Upload Maestro debug output"));
    assert.match(step, /if: always\(\)/, "the sweep skips the runs it exists for");
    assert.match(step, /\[ -s "\$out\/found\.txt" \] \|\|/, "an empty sweep leaves no record of having searched");
    const upload = src.slice(src.indexOf("name: maestro-debug"), src.indexOf("if-no-files-found"));
    assert.ok(upload.includes("emulator-logs/"), "the sweep's output is collected and then not uploaded");
  });

  test("the sweep reaches inside the emulator's crash database", () => {
    const step = src.slice(src.indexOf("Collect whatever the emulator wrote"), src.indexOf("Upload Maestro debug output"));
    assert.match(step, /-ipath '\*crash\*'/, "a dump inside emu-crash-*.db is not named for a crash, so a name match misses it");
    const depth = Number(/-maxdepth (\d+) -type f/.exec(step)?.[1]);
    assert.ok(depth >= 5, `depth ${depth} stops short of <tmp>/android-runner/emu-crash-*.db/attachments/<id>/<file>`);
  });

  test("the kernel's record of how the emulator ended is taken and uploaded", () => {
    const trace = src.slice(src.indexOf("Trace every signal and exit"), src.indexOf("Install Maestro"));
    for (const event of ["signal/signal_generate", "sched/sched_process_exit", "syscalls/sys_enter_exit_group"]) {
      assert.ok(trace.includes(event), `${event} is not traced`);
    }
    const upload = src.slice(src.indexOf("name: maestro-debug"), src.indexOf("if-no-files-found"));
    for (const file of ["kernel-trace.txt", "journal.txt", "coredump.txt"]) {
      assert.ok(upload.includes(file), `${file} is collected and then not uploaded`);
    }
  });

  test("a trace that cannot be read is not reported as one never started", () => {
    const step = src.slice(src.indexOf("Say how the emulator exited"), src.indexOf("Upload Maestro debug output"));
    assert.doesNotMatch(step, /&& sudo cat [^\n]*\|\| echo "no kernel trace was started"/);
    assert.match(step, /coredumpctl info [^\n]*coredump\.txt/, "the core dump's own account of the crash is not taken");
  });

  test("the warning names the fatal signal whichever thread took it, not qemu's vCPU kicks", () => {
    const step = src.slice(src.indexOf("Say how the emulator exited"), src.indexOf("Upload Maestro debug output"));
    const pipeline = /exits=\$\(grep -E "([^"]+)" [^|]*\| (head|tail) -(\d+)/.exec(step);
    assert.ok(pipeline, "the exit summary is no longer one grep into head or tail");
    const kept = (lines: string[]) => lines.filter((l) => new RegExp(pipeline[1]).test(l));
    const trace = [
      ...Array.from({ length: 8 }, (_, i) => `qemu-system-x86-5329 [001] d..1. 90.${i}: signal_generate: sig=10 errno=0 code=-6 comm=qemu-system-x86 pid=${5400 + i} grp=0 res=0`),
      "RenderThread-6991 [003] d..1. 91.0: signal_generate: sig=11 errno=0 code=1 comm=RenderThread pid=6991 grp=1 res=0",
      ...Array.from({ length: 8 }, (_, i) => `RenderThread-6991 [003] d..1. 91.1: signal_generate: sig=9 errno=0 code=128 comm=qemu-system-x86 pid=${5400 + i} grp=1 res=0`),
    ];
    const shown = kept(trace);
    const window = pipeline[2] === "head" ? shown.slice(0, Number(pipeline[3])) : shown.slice(-Number(pipeline[3]));
    assert.ok(window.some((l) => l.includes("sig=11")), "the SIGSEGV that ended the emulator is not in the warning");
    assert.ok(!shown.some((l) => l.includes("sig=10")), "qemu's SIGUSR1 vCPU kicks crowd the warning");
  });

  test("the host renders with ANGLE, not the legacy SwiftShader GL that segfaulted on its RenderThread", () => {
    const options = /emulator-options: (.*)/.exec(read(ACTION))?.[1] ?? "";
    assert.match(options, /-gpu swangle_indirect\b/);
  });

  test("the tombstone search reads the stream that survives the device", () => {
    const step = src.slice(src.indexOf("id: crash"), src.indexOf("Upload Maestro debug output"));
    assert.match(
      step,
      /find-native-crash\.mjs android "\$APP_ID"[^\n]*"\$RUNNER_TEMP\/logcat\.txt"/,
      "the crash check reads only Maestro's own logcat, which does not exist when " +
        "the device died before Maestro could pull it",
    );
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
