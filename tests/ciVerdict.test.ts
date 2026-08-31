// tests/ciVerdict.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  decideVerdict,
  ghExecOptions,
  runForHead,
  runListArgs,
  stripLogPrefix,
} from "../lib/ticketPipeline/ciVerdict.ts";

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
  // run executes is the case that tells these apart. `android-build`/`ios-build` skip whenever
  // no native input changed, so without this every genuinely red run would be read as
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
