// tests/ciVerdict.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { decideVerdict, runListArgs } from "../lib/ticketPipeline/ciVerdict.ts";

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

  test("cancelled and timed_out are not passes", () => {
    for (const conclusion of ["cancelled", "timed_out", "startup_failure", null]) {
      assert.equal(decideVerdict(done(conclusion)).pass, false, `${conclusion} must not pass`);
    }
  });
});
