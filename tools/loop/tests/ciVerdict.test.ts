// tools/loop/tests/ciVerdict.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  ciProgress,
  decideVerdict,
  failedLogArgs,
  failingTestIds,
  ghExecOptions,
  readHeadCi,
  readLandingState,
  readVerdict,
  runForHead,
  runListArgs,
  stripLogPrefix,
} from "../ciVerdict.ts";
import { ciRedBody } from "../queue-loop.mjs";
import * as budgetGate from "../../ci/budget-gate.mjs";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const jestProjects: string[] = createRequire(import.meta.url)("../../../jest.config.js").projects.map(
  (p: { displayName: string }) => p.displayName,
);

const done = (conclusion: string | null) => ({ databaseId: 7, conclusion, status: "completed" });

describe("reading ci.yml's verdict", () => {
  test("a successful run passes and carries its id", () => {
    const v = decideVerdict(done("success"));
    assert.equal(v.pass, true);
    assert.equal(v.runId, 7);
  });

  test("a failed run does not pass, and names the failing job", () => {
    const v = decideVerdict(done("failure"), [
      { name: "Typecheck, tests, lint", conclusion: "failure", steps: 9 },
      { name: "Browser tests", conclusion: "success", steps: 6 },
    ]);
    assert.equal(v.pass, false);
    assert.equal(v.failedStep, "Typecheck, tests, lint");
    assert.ok(!v.infrastructure);
  });

  // A job that finished with no steps ran nothing. Billing, a quota or a runner failure looks
  // exactly like a red suite from outside, and a fix agent sent after one hunts a defect that
  // nothing reported.
  test("a job that ran no steps is infrastructure, not a defect", () => {
    const v = decideVerdict(done("failure"), [{ name: "scope", conclusion: "failure", steps: 0 }]);
    assert.equal(v.pass, false);
    assert.equal(v.infrastructure, true);
    assert.equal(v.failedStep, "scope");
  });

  test("a genuine red suite is never called infrastructure", () => {
    const v = decideVerdict(done("failure"), [{ name: "Browser tests", conclusion: "failure", steps: 6 }]);
    assert.ok(!v.infrastructure);
  });

  // A skipped job also reports zero steps, and a gate that skips one job while the rest of the
  // run executes is the case that tells these apart. `android-build`/`ios-build` skip on
  // every run that does not need them, so without this every genuinely red run would be read as
  // infrastructure, and `driveToGreen` would abort instead of sending a fix agent.
  test("a job skipped by its gate is not infrastructure, and the real failure still names itself", () => {
    const v = decideVerdict(done("failure"), [
      { name: "Typecheck and tests", conclusion: "failure", steps: 9 },
      { name: "Android compiles", conclusion: "skipped", steps: 0 },
      { name: "iOS compiles", conclusion: "skipped", steps: 0 },
    ]);
    assert.equal(v.pass, false);
    assert.ok(!v.infrastructure);
    assert.equal(v.failedStep, "Typecheck and tests");
  });

  // The distinction is the conclusion, not the order: a stepless *failure* alongside a skip is
  // still infrastructure.
  test("a stepless failure is still infrastructure even next to a skipped job", () => {
    const v = decideVerdict(done("failure"), [
      { name: "Android compiles", conclusion: "skipped", steps: 0 },
      { name: "scope", conclusion: "failure", steps: 0 },
    ]);
    assert.equal(v.infrastructure, true);
    assert.equal(v.failedStep, "scope");
  });

  test("a run still in progress does not pass", () => {
    const v = decideVerdict({ databaseId: 7, conclusion: null, status: "in_progress" });
    assert.equal(v.pass, false);
  });

  // The floor. Every other case has a run to read; this is the one where the verdict has no
  // evidence at all, and it must fail closed rather than default to a pass.
  test("no run at all fails closed", () => {
    const v = decideVerdict(undefined);
    assert.equal(v.pass, false);
    assert.match(v.reason, /no run/);
  });

  // Failing closed is not enough on its own: without the flag the caller reads this as a red
  // suite and spends its fix rounds on a failure no run ever reported. A GitHub API outage
  // returned exactly this and the branch underneath it was green.
  test("no run at all is infrastructure, not a defect", () => {
    assert.equal(decideVerdict(undefined).infrastructure, true);
  });

  // Maestro and EAS run on the same branch, and `--limit 1` with no filter returns whichever of
  // them finished last: a green Maestro over a red ci.yml is a red branch reading as green.
  test("the run query asks for ci.yml and nothing else", () => {
    const args = runListArgs("metasito/murlan", "agent/1-x");
    assert.ok(args.includes("--workflow"), "the query does not name a workflow");
    assert.equal(args[args.indexOf("--workflow") + 1], "ci.yml");
    assert.ok(args.includes("agent/1-x"));
  });

  // A fix round pushes and asks straight away. For the seconds before the new run registers,
  // the newest row on the branch is the previous push's — completed, and red, which is why the
  // round was run at all. Reading it sends another fix agent after a failure already fixed.
  describe("choosing which run answers for this push", () => {
    const row = (headSha: string, conclusion: string) => ({
      databaseId: headSha.length,
      conclusion,
      status: "completed",
      headSha,
    });

    test("takes the run for this head, not the newest one", () => {
      const chosen = runForHead([row("aaa", "failure"), row("bbbb", "success")], "bbbb");
      assert.equal(chosen?.conclusion, "success");
    });

    test("finds nothing when only the previous push has a run", () => {
      assert.equal(runForHead([row("aaa", "failure")], "bbbb"), undefined);
    });

    // Without a head to match on there is nothing better than the newest row, and answering
    // "no run" there would fail a branch whose suite is green.
    test("falls back to the newest run when the head is unknown", () => {
      assert.equal(runForHead([row("aaa", "failure")], undefined)?.headSha, "aaa");
    });
  });

  test("the run query reports each run's head, so a stale one can be told apart", () => {
    const args = runListArgs("metasito/murlan", "agent/1-x");
    assert.match(args[args.indexOf("--json") + 1], /headSha/);
  });

  // `gh run view --log-failed` for a browser-test job runs to several megabytes. Node's default
  // 1MB buffer turned that into ENOBUFS, which the catch reported to the fix agent as
  // "(could not read the failed log)" — #200's fix round then spent 76 minutes reproducing a
  // failure CI had already described in full.
  test("gh is given a buffer big enough for a failed job's log", () => {
    const { maxBuffer } = ghExecOptions();
    assert.ok(
      typeof maxBuffer === "number" && maxBuffer > 1024 * 1024,
      `maxBuffer is ${maxBuffer}; Node's 1MB default is smaller than any real CI log`
    );
  });

  describe("the failed log a fix round is handed", () => {
    const real =
      "Browser tests	Browser tests	2026-08-26T02:24:03.9111584Z     Error: clipped at the cap";

    test("loses its job, step and timestamp prefix", () => {
      assert.equal(stripLogPrefix(real), "    Error: clipped at the cap");
    });

    // The strip must not eat content: a line that never carried the prefix is not one to trim.
    test("leaves a line without the prefix untouched", () => {
      for (const line of ["", "    at Object.<anonymous>", "Error: plain", "a	b	c"]) {
        assert.equal(stripLogPrefix(line), line);
      }
    });
  });

  test("cancelled and timed_out are not passes", () => {
    for (const conclusion of ["cancelled", "timed_out", "startup_failure", null]) {
      assert.equal(decideVerdict(done(conclusion)).pass, false, `${conclusion} must not pass`);
    }
  });
});

// Run 33862429187, verbatim in shape: gitleaks went red, the run failed fast, and every sibling
// was cancelled — including a reporting job cancelled before its first step. Asked stepless-first,
// the verdict named that cancelled job and said `infrastructure: true`, so the loop would have
// re-asked instead of fixing the one job that actually reported something.
describe("a red job that cancelled its siblings", () => {
  const run = { databaseId: 33862429187, status: "completed", conclusion: "failure" } as never;
  const jobs = [
    { name: "Secret scan", conclusion: "failure", steps: 8 },
    { name: "Typecheck and tests", conclusion: "cancelled", steps: 14 },
    { name: "Browser test report", conclusion: "cancelled", steps: 0 },
  ] as never[];

  test("is reported as the failure it is, not as infrastructure", () => {
    const v = decideVerdict(run, jobs);
    assert.equal(v.pass, false);
    assert.notEqual(v.infrastructure, true);
    assert.equal(v.failedStep, "Secret scan");
  });

  test("a cancelled stepless job on its own is still not infrastructure", () => {
    const v = decideVerdict(run, [{ name: "Browser test report", conclusion: "cancelled", steps: 0 }] as never[]);
    assert.notEqual(v.infrastructure, true);
  });

  // Run 35628365126 (#1101): Native tests red, iOS cancelled mid-compile, so the run read cancelled.
  test("a cancelled run with a red job hands the red back", () => {
    const cancelled = { databaseId: 35628365126, status: "completed", conclusion: "cancelled" } as never;
    const v = decideVerdict(cancelled, [
      { name: "Native tests", conclusion: "failure", steps: 8 },
      { name: "iOS compiles", conclusion: "cancelled", steps: 12 },
    ] as never[]);
    assert.notEqual(v.infrastructure, true);
    assert.equal(v.failedStep, "Native tests");
    const onlyCancelled = decideVerdict(cancelled, [{ name: "iOS compiles", conclusion: "cancelled", steps: 12 }] as never[]);
    assert.equal(onlyCancelled.infrastructure, true);
  });

  test("a genuinely stepless job with no failure anywhere is still infrastructure", () => {
    const v = decideVerdict(run, [{ name: "Build and boot", conclusion: "failure", steps: 0 }] as never[]);
    assert.equal(v.infrastructure, true);
  });
});

// ci.yml's concurrency group cancels an in-progress pull-request run on every new push, and a job
// that never started carries conclusion null with zero steps. null is not success, skipped or
// cancelled, so it fell into `stepless` — the right answer by the wrong route, on a path the loop
// exercises constantly.
describe("a cancelled run", () => {
  const run = { databaseId: 34703225931, status: "completed", conclusion: "cancelled" } as never;

  test("says nothing about the diff, whatever its unstarted jobs report", () => {
    const v = decideVerdict(run, [{ name: "Lint", conclusion: null, steps: 0 }] as never[]);
    assert.equal(v.pass, false);
    assert.equal(v.infrastructure, true);
    assert.match(v.reason, /cancelled/);
  });

  test("a job that never started is not evidence of a runner failure", () => {
    const v = decideVerdict(
      { databaseId: 1, status: "completed", conclusion: "failure" } as never,
      [
        { name: "Lint", conclusion: null, steps: 0 },
        { name: "Typecheck and tests", conclusion: "failure", steps: 11 },
      ] as never[],
    );
    assert.notEqual(v.infrastructure, true);
    assert.equal(v.failedStep, "Typecheck and tests");
  });

  // `settle` waits on `waiting` without spending a round; without the flag a seven-minute run
  // exhausts an eight-round recheck budget and parks a healthy branch.
  test("a run that has not finished says so, rather than reading as a failure to budget", () => {
    assert.equal(decideVerdict({ databaseId: 1, status: "in_progress", conclusion: null } as never).waiting, true);
    assert.equal(
      decideVerdict({ databaseId: 1, status: "completed", conclusion: "failure" } as never).waiting,
      undefined,
    );
  });

  test("a run that never appeared is not the same wait, because it may never appear", () => {
    const none = decideVerdict(undefined);
    assert.equal(none.waiting, undefined, "an absent run would wait out the whole deadline");
    assert.equal(none.appearing, true);
  });
});

// `CI gate` runs under `always()` and fails whenever another job did not pass, so its own red is
// never the failure: it would name itself, or call a cancelled run a red one.
describe("the CI gate job", () => {
  const gate = { name: "CI gate", conclusion: "failure", steps: 3 };

  test("is never the failing job a red run names", () => {
    const v = decideVerdict({ databaseId: 1, status: "completed", conclusion: "failure" } as never, [
      gate,
      { name: "Lint", conclusion: "failure", steps: 5 },
    ] as never[]);
    assert.equal(v.failedStep, "Lint");
  });

  test("does not turn a cancelled run into a red one", () => {
    const v = decideVerdict({ databaseId: 1, status: "completed", conclusion: "cancelled" } as never, [
      { name: "Native tests 1/2", conclusion: "cancelled", steps: 4 },
      gate,
    ] as never[]);
    assert.equal(v.infrastructure, true);
    assert.match(v.reason, /cancelled/);
  });

  test("red with no other job red is infrastructure that names it, never an empty red", () => {
    const v = decideVerdict({ databaseId: 1, status: "completed", conclusion: "failure" } as never, [
      { name: "Lint", conclusion: "success", steps: 5 },
      { name: "Browser tests", conclusion: "skipped", steps: 0 },
      gate,
    ] as never[]);
    assert.equal(v.infrastructure, true);
    assert.equal(v.failedStep, "CI gate");
  });
});

// The step names come from budget-gate.mjs, which ci.yml's Timing budget job is pinned to
// (tests/tooling/ciGate.test.ts).
describe("a red Timing budget", () => {
  const red = (failedSteps: string[]) =>
    decideVerdict({ databaseId: 1, status: "completed", conclusion: "failure" } as never, [
      { name: "Native tests 1/2", conclusion: "success", steps: 9 },
      { name: "Timing budget", conclusion: "failure", steps: 4, failedSteps },
      { name: "CI gate", conclusion: "failure", steps: 3, failedSteps: ["Every job passed or was skipped by scope"] },
    ] as never[]);

  test("that could not read the run's lists is infrastructure, as the supervisor's own gate called it", () => {
    assert.ok(budgetGate.UNREAD_STEP, "budget-gate.mjs names no reading step");
    const v = red([budgetGate.UNREAD_STEP]);
    assert.equal(v.infrastructure, true);
    assert.equal(v.failedStep, "Timing budget");
    assert.match(v.reason, /over-budget lists/);
  });

  test("on a finding is the diff's own red", () => {
    const v = red(["No test file this pull request touches ran over its budget"]);
    assert.notEqual(v.infrastructure, true);
    assert.equal(v.failedStep, "Timing budget");
  });
});

// Measured: run 37665945841 hit verify's timeout-minutes; run 36503903790 lost to a newer push.
// Both read job `cancelled`, run `cancelled`, a cancelled step; only the annotation differs.
describe("a job stopped by its own timeout-minutes", () => {
  const cancelledRun = (databaseId: number) =>
    ({ databaseId, status: "completed", conclusion: "cancelled", headSha: "h" }) as const;
  const fakeGh = (runId: number, jobId: number, annotation: string) => {
    const asked: string[][] = [];
    const gh = (args: string[]) => {
      asked.push(args);
      if (args[0] === "pr") return JSON.stringify({ headRefOid: "h" });
      if (args[0] === "run" && args[1] === "list") return JSON.stringify([cancelledRun(runId)]);
      if (args[0] === "api" && args[1] === `repos/o/r/check-runs/${jobId}/annotations`) {
        return JSON.stringify([annotation, "The operation was canceled."]);
      }
      if (args.includes("--log")) return "Install postgresql-client\n##[error]The operation was canceled.";
      if (args.includes("--log-failed")) return "";
      return JSON.stringify([
        { name: "Lint", conclusion: "success", status: "completed", steps: 9, id: jobId - 1 },
        { name: "Typecheck and tests", conclusion: "cancelled", status: "completed", steps: 13, id: jobId },
      ]);
    };
    return { gh, asked };
  };

  test("reaches a fix round naming the job, with that job's own log", () => {
    const { gh } = fakeGh(37665945841, 112945168721, "The job has exceeded the maximum execution time of 20m0s");
    const v = readVerdict("o/r", "agent/1-x", 1, Date.now() + 60_000, gh);
    assert.equal(v.pass, false);
    assert.notEqual(v.infrastructure, true);
    assert.equal(v.failedStep, "Typecheck and tests");
    assert.match(v.reason, /timeout-minutes/);
    assert.match(v.output ?? "", /Install postgresql-client/);
    assert.deepEqual(v.logArgs, ["run", "view", "--job", "112945168721", "--repo", "o/r", "--log"]);
  });

  test("a job that failed outranks a timed-out one listed before it", () => {
    const jobs = [
      { name: "Typecheck and tests", conclusion: "cancelled", steps: 13, id: 1, timedOut: true },
      { name: "Browser tests 1/4", conclusion: "failure", steps: 11, id: 2 },
    ];
    const v = decideVerdict({ databaseId: 9, status: "completed", conclusion: "failure" }, jobs);
    assert.equal(v.failedStep, "Browser tests 1/4");
    assert.deepEqual(failedLogArgs("o/r", 9, jobs, v.failedStep), ["run", "view", "9", "--repo", "o/r", "--log-failed"]);
  });

  test("names the timed-out job when the run itself concluded failure", () => {
    const v = decideVerdict({ databaseId: 1, status: "completed", conclusion: "failure" }, [
      { name: "Lint", conclusion: "success", steps: 9 },
      { name: "iOS compiles", conclusion: "cancelled", steps: 12, timedOut: true },
    ]);
    assert.notEqual(v.infrastructure, true);
    assert.equal(v.failedStep, "iOS compiles");
  });

  test("a run cancelled by a newer push still reads as infrastructure", () => {
    const { gh, asked } = fakeGh(
      36503903790,
      109200926319,
      "Canceling since a higher priority waiting request for ci-CI-refs/pull/1323/merge exists",
    );
    const v = readVerdict("o/r", "agent/1-x", 1, Date.now() + 60_000, gh);
    assert.ok(asked.some((a) => a[1] === "repos/o/r/check-runs/109200926319/annotations"));
    assert.equal(v.infrastructure, true);
    assert.equal(v.failedStep, undefined);
  });
});

describe("failing test ids from a CI log", () => {
  test("a Playwright failure names its file and title, line:col dropped, retries de-duplicated", () => {
    const log = [
      "  1) [chromium] › tests/e2e/accountRecovery.spec.ts:9:5 › account recovery — verify a fresh address, then reset a forgotten password ",
      "",
      "    Error: no console errors/warnings during account recovery",
      "",
      "    Retry #1 ───────────────────────────────────────────────────────────────────────────────────────",
      "",
      "    Error: no console errors/warnings during account recovery",
      "",
      "  1 failed",
      "    [chromium] › tests/e2e/accountRecovery.spec.ts:9:5 › account recovery — verify a fresh address, then reset a forgotten password ",
      "  26 passed (3.6m)",
    ].join("\n");
    assert.deepEqual(failingTestIds(log), [
      "tests/e2e/accountRecovery.spec.ts › account recovery — verify a fresh address, then reset a forgotten password",
    ]);
  });

  test("a node:test failure (spec reporter) names its file and the failing test", () => {
    const log = [
      "✖ failing tests:",
      "",
      "test at tests/ui-rules/i18n.test.ts:635:3",
      "✖ every error code the server can emit has a server.* key (11.81613ms)",
      "  AssertionError [ERR_ASSERTION]: these codes have no server.* translation: NO_LIVE_GAME",
      "",
      "test at tests/ui-rules/reactCompiler.test.ts:176:1",
      "✖ every screen and component compiles with no bailouts (12178.66072ms)",
      "  AssertionError [ERR_ASSERTION]: the React Compiler silently skipped these.",
    ].join("\n");
    assert.deepEqual(failingTestIds(log), [
      "tests/ui-rules/i18n.test.ts › every error code the server can emit has a server.* key",
      "tests/ui-rules/reactCompiler.test.ts › every screen and component compiles with no bailouts",
    ]);
  });

  test("a jest failure names its file", () => {
    assert.deepEqual(failingTestIds("FAIL tests/native/x.test.tsx"), ["tests/native/x.test.tsx"]);
  });

  test("a jest failure behind a project name names its file, never the project", () => {
    const log = [
      "FAIL android tests/native/musicPlatform.test.tsx",
      "FAIL ios tests/native/musicPlatform.test.tsx",
      "FAIL tests/native/musicPlatform.test.tsx",
    ].join("\n");
    assert.deepEqual(failingTestIds(log), ["tests/native/musicPlatform.test.tsx"]);
  });

  test("no jest project name in jest.config.js is ever a test id", () => {
    assert.ok(jestProjects.length > 0, "jest.config.js declares no projects: this test no longer checks anything");
    for (const name of jestProjects) {
      const ids = failingTestIds(`FAIL ${name} tests/native/x.test.tsx\nFAIL ${name} tests/native/y.test.tsx (5.2 s)`);
      assert.deepEqual(ids, ["tests/native/x.test.tsx", "tests/native/y.test.tsx"], name);
    }
  });

  test("a log with no failures names none, a TAP-shaped line included", () => {
    const log = [
      "  ✓  27 [chromium] › tests/e2e/reconnect.spec.ts:21:5 › online — a dropped connection says so, and the table comes back (33.5s)",
      "  28 passed (1.2m)",
      "not ok 3 - a line from some other reporter",
    ].join("\n");
    assert.deepEqual(failingTestIds(log), []);
  });
});

describe("readHeadCi", () => {
  const asked: string[][] = [];
  const gh = (args: string[]) => {
    asked.push(args);
    return args[0] === "api" ? "abc" : "[]";
  };

  test("asks the pull request list only for the number it returns", () => {
    const out = readHeadCi("o/r", "agent/1-x", gh, Date.now() + 60_000);
    assert.equal(out.pr, null);
    const list = asked.find((a) => a[0] === "pr" && a[1] === "list");
    assert.equal(list?.[list.indexOf("--json") + 1], "number");
  });
});

describe("a green run over a test file the pull request touched", () => {
  const green = { databaseId: 41, status: "completed", conclusion: "success", headSha: "h" };
  const native = "tests/native/mancheOutcomeOnTheFelt.test.tsx";
  const spec = "tests/e2e/tableProportions.spec.ts";
  type PrFile = { filename: string; status: string; patch?: string };
  type Fake = { download?: () => void; listed?: string[]; asked?: string[][] };
  const fakeGh = (lists: Record<string, object[]>, files: PrFile[], { download, listed, asked }: Fake = {}) => (args: string[]) => {
    asked?.push(args);
    if (args[0] === "pr" && args[1] === "list") return JSON.stringify([{ number: 1 }]);
    if (args[0] === "pr") return JSON.stringify({ headRefOid: "h" });
    if (args[0] === "run" && args[1] === "list") return JSON.stringify([green]);
    if (args[0] === "api" && args[1] === "repos/o/r/git/ref/heads/agent/1-x") return "h";
    if (args[0] === "api" && args[1].startsWith("repos/o/r/actions/runs/41/artifacts")) return (listed ?? Object.keys(lists)).join("\n");
    if (args[0] === "run" && args[1] === "download") {
      download?.();
      const dir = args[args.indexOf("--dir") + 1];
      for (const [name, list] of Object.entries(lists)) {
        mkdirSync(path.join(dir, name), { recursive: true });
        writeFileSync(path.join(dir, name, "over-budget.json"), JSON.stringify(list));
      }
      return "";
    }
    if (args[0] === "api" && args[1].startsWith("repos/o/r/pulls/1/files")) return files.map((f) => JSON.stringify(f)).join("\n");
    throw new Error(`unexpected gh ${args.join(" ")}`);
  };
  const lists = {
    "over-budget-native-1": [{ file: native, seconds: 32.9, budget: 15 }],
    "over-budget-browser-2": [{ file: spec, seconds: 94, budget: 75.6 }],
  };
  const read = (gh: (args: string[]) => string) => readVerdict("o/r", "agent/1-x", 1, Date.now() + 60_000, gh);

  test("is a CI fix round at `timing budget`, whose CI-RED names the file", () => {
    const v = read(fakeGh(lists, [{ filename: native, status: "modified" }, { filename: "lib/x.ts", status: "modified" }]));
    assert.equal(v.pass, false);
    assert.notEqual(v.infrastructure, true);
    assert.equal(v.failedStep, "timing budget");
    assert.deepEqual(v.testIds, [native]);
    assert.match(v.output ?? "", /mancheOutcomeOnTheFelt\.test\.tsx.*32\.9s.*15s/);
    assert.doesNotMatch(v.output ?? "", /tableProportions/);
    assert.ok(v.logArgs?.includes("over-budget-*"), String(v.logArgs));
    const body = ciRedBody({ sha: "h", runUrl: "u", failedStep: v.failedStep, testIds: v.testIds, excerpt: v.output, logArgs: v.logArgs, reason: v.reason });
    assert.match(body, /step: timing budget/);
    assert.match(body, new RegExp(`^- ${native.replace(/\./g, "\\.")}$`, "m"));
  });

  test("passes when the file over budget is one the pull request did not touch", () => {
    assert.equal(read(fakeGh(lists, [{ filename: "lib/x.ts", status: "modified" }])).pass, true);
    assert.equal(read(fakeGh({}, [{ filename: native, status: "modified" }])).pass, true);
  });

  test("is the same fix round when the pull request raises its own spec's recorded time past the ratio", () => {
    const raise = (to: number) =>
      fakeGh({}, [
        { filename: spec, status: "modified" },
        { filename: "tests/e2e/timings.json", status: "modified", patch: `@@ -40,3 +40,3 @@\n-  "tableProportions.spec.ts": 22.8,\n+  "tableProportions.spec.ts": ${to},\n` },
      ]);
    const v = read(raise(90));
    assert.equal(v.failedStep, "timing budget");
    assert.deepEqual(v.testIds, [spec]);
    assert.match(v.output ?? "", /22\.8s.*90s/);
    assert.equal(read(raise(30)).pass, true);
  });

  test("passes a new spec with no recorded time, and says it has no budget yet", () => {
    const v = read(fakeGh(lists, [{ filename: "tests/e2e/brandNew.spec.ts", status: "added" }]));
    assert.equal(v.pass, true);
    assert.match(v.reason, /no budget yet.*tests\/e2e\/brandNew\.spec\.ts/);
  });

  test("a list that cannot be read is not a pass", () => {
    const v = read(fakeGh(lists, [{ filename: native, status: "modified" }], {
      download: () => {
        throw new Error("HTTP 410: artifact expired");
      },
    }));
    assert.equal(v.pass, false);
    assert.equal(v.infrastructure, true);
  });

  // Run 38229501646, attempt 2: the artifacts endpoint lists every attempt's upload, two `blob-report-15` among them.
  test("a list a rerun uploaded twice under one name is read once, not refused", () => {
    const one = { "over-budget-native-1": lists["over-budget-native-1"] };
    const v = read(fakeGh(one, [{ filename: native, status: "modified" }], { listed: ["over-budget-native-1", "over-budget-native-1"] }));
    assert.notEqual(v.infrastructure, true, v.reason);
    assert.equal(v.failedStep, "timing budget");
  });

  test("a pull request that changes no test file downloads nothing", () => {
    const asked: string[][] = [];
    assert.equal(read(fakeGh(lists, [{ filename: "lib/x.ts", status: "modified" }], { asked })).pass, true);
    assert.ok(!asked.some((a) => a[1] === "download" || /\/artifacts/.test(a[1] ?? "")), JSON.stringify(asked));
  });

  test("a file over budget on both projects is one finding, at its slower time", () => {
    const both = {
      "over-budget-native-1": [{ file: native, seconds: 20, budget: 15 }],
      "over-budget-native-2": [{ file: native, seconds: 32.9, budget: 15 }],
    };
    const v = read(fakeGh(both, [{ filename: native, status: "modified" }]));
    const lines = (v.output ?? "").split("\n").filter((l) => l.includes(native));
    assert.deepEqual(lines, [`  ${native}: 32.9s against a budget of 15s`]);
  });

  test("readHeadCi, which derives the phase, holds the same gate", () => {
    const { verdict } = readHeadCi("o/r", "agent/1-x", fakeGh(lists, [{ filename: native, status: "modified" }]), Date.now() + 60_000);
    assert.equal(verdict.pass, false);
    assert.equal(verdict.failedStep, "timing budget");
  });
});

describe("a run still going", () => {
  test("counts finished jobs and names the first red one", () => {
    const p = ciProgress([
      { name: "lint", conclusion: "failure", status: "completed", steps: 3 },
      { name: "unit", conclusion: "success", status: "completed", steps: 3 },
      { name: "e2e", conclusion: null, status: "in_progress", steps: 2 },
      { name: "build", conclusion: null, status: "queued", steps: 0 },
    ]);
    assert.deepEqual(p, { done: 2, total: 4, running: "e2e", failed: "lint" });
  });
});

describe("readLandingState, from rollups recorded off live pull requests", () => {
  type Fixture = { view: Record<string, unknown> & { statusCheckRollup: Record<string, string>[] }; run?: object; jobs?: object[] };
  const fixture = (name: string): Fixture =>
    JSON.parse(readFileSync(path.join(import.meta.dirname, "fixtures", `rollup-${name}.json`), "utf8"));
  const LOG = "Typecheck and tests\tTest\t2026-10-12T19:07:30Z test at tools/loop/tests/x.test.ts:9:5\n✖ breaks (2.1ms)";
  const read = (f: Fixture, over: Record<string, unknown> = {}) => {
    const asked: string[][] = [];
    const gh = (args: string[]) => {
      asked.push(args);
      if (args[0] === "pr" && args[1] === "view") return JSON.stringify({ ...f.view, ...over });
      if (args[0] === "run" && args[1] === "view" && args.includes("--log-failed")) return LOG;
      if (args[0] === "run" && args[1] === "view" && args.includes("jobs")) return JSON.stringify(f.jobs);
      if (args[0] === "run" && args[1] === "view") return JSON.stringify(f.run);
      throw new Error(`unexpected gh ${args.join(" ")}`);
    };
    return { state: readLandingState("metasito/murlan", 7, gh, Date.now() + 60_000), asked };
  };

  test("one call reads the head, the merge state, the arming and the rollup", () => {
    const { state, asked } = read(fixture("green"));
    assert.equal(asked.length, 1);
    assert.deepEqual(asked[0].slice(0, 5), ["pr", "view", "7", "--repo", "metasito/murlan"]);
    assert.equal(asked[0][asked[0].indexOf("--json") + 1], "headRefOid,state,mergeable,mergeStateStatus,isDraft,autoMergeRequest,statusCheckRollup");
    assert.equal(state.pr.headRefOid, fixture("green").view.headRefOid);
    assert.equal(state.pr.mergeStateStatus, "CLEAN");
    assert.equal(state.pr.armed, false);
  });

  test("a SUCCESS gate passes, naming its run", () => {
    const { state } = read(fixture("green"));
    assert.equal(state.ci.pass, true);
    assert.equal(state.ci.runId, 38298348044);
    assert.equal(state.ci.head, fixture("green").view.headRefOid);
  });

  test("a gate not yet reported, with the run's other jobs going, waits and says how far it got", () => {
    const { state } = read(fixture("absent"));
    assert.equal(state.ci.pass, false);
    assert.equal(state.ci.waiting, true);
    assert.match(state.ci.reason, /CI gate has not reported/);
    assert.deepEqual(state.progress, { done: 7, total: 28, running: "Typecheck and tests", failed: null });
  });

  test("a gate that has reported and not completed waits, with progress from the other entries", () => {
    const { state } = read(fixture("pending"));
    assert.equal(state.ci.waiting, true);
    assert.match(state.ci.reason, /CI gate is (queued|in_progress)/);
    assert.equal(state.progress.total, fixture("pending").view.statusCheckRollup.length - 1);
  });

  test("a head no check has reported on yet is a run still appearing, on its own budget", () => {
    const { state } = read(fixture("absent"), { statusCheckRollup: [] });
    assert.equal(state.ci.pass, false);
    assert.equal(state.ci.appearing, true);
    assert.equal(state.ci.infrastructure, true);
  });

  test("a red gate reaches decideVerdict with that run's own jobs and log", () => {
    const { state, asked } = read(fixture("red"));
    assert.equal(state.ci.pass, false);
    assert.notEqual(state.ci.infrastructure, true);
    assert.equal(state.ci.runId, 38295085768);
    assert.equal(state.ci.failedStep, "Typecheck and tests");
    assert.deepEqual(state.ci.testIds, ["tools/loop/tests/x.test.ts › breaks"]);
    assert.ok(asked.every((a) => a[0] === "pr" || a.includes("38295085768")), JSON.stringify(asked));
  });

  test("autoMergeRequest set is armed", () => {
    const { state } = read(fixture("red"), { autoMergeRequest: { mergeMethod: "MERGE", enabledAt: "2026-10-12T19:05:00Z" } });
    assert.equal(state.pr.armed, true);
  });

  test("a pull request gh cannot read throws, for the caller to judge", () => {
    const gh = () => {
      throw new Error("error connecting to api.github.com");
    };
    assert.throws(() => readLandingState("metasito/murlan", 7, gh, Date.now() + 60_000), /error connecting/);
  });
});
