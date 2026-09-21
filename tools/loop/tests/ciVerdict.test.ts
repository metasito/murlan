// tools/loop/tests/ciVerdict.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  ciProgress,
  decideVerdict,
  failingTestIds,
  ghExecOptions,
  readHeadCi,
  runForHead,
  runListArgs,
  stripLogPrefix,
} from "../ciVerdict.ts";
import { createRequire } from "node:module";

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
  // every run but the weekly schedule, so without this every genuinely red run would be read as
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
      "test at tests/i18n.test.ts:635:3",
      "✖ every error code the server can emit has a server.* key (11.81613ms)",
      "  AssertionError [ERR_ASSERTION]: these codes have no server.* translation: NO_LIVE_GAME",
      "",
      "test at tests/reactCompiler.test.ts:176:1",
      "✖ every screen and component compiles with no bailouts (12178.66072ms)",
      "  AssertionError [ERR_ASSERTION]: the React Compiler silently skipped these.",
    ].join("\n");
    assert.deepEqual(failingTestIds(log), [
      "tests/i18n.test.ts › every error code the server can emit has a server.* key",
      "tests/reactCompiler.test.ts › every screen and component compiles with no bailouts",
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
