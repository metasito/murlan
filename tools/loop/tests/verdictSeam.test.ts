// tools/loop/tests/verdictSeam.test.ts
//
// `decideVerdict` produces the verdict and `landing` consumes it. Each has its own suite, each was
// green, and the defect lived between them: `readVerdict` used to block until the run settled, so
// `landing` could read `pass !== true` as "red". Removing that block made an in-flight run read as
// a red branch, and #1028 burned three fix rounds on a log that was never written.
//
// So this suite owns neither function. It walks every verdict the first can emit and asserts what
// the second is allowed to do with it.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { decideVerdict, type JobRow, type RunRow } from "../ciVerdict.ts";
import { landing, type PrState } from "../land.ts";

const STATUSES = ["queued", "in_progress", "completed"];
const CONCLUSIONS = [null, "success", "failure", "cancelled", "timed_out", "startup_failure"];
const JOB_SETS: Record<string, JobRow[]> = {
  none: [],
  red: [{ name: "Native tests", conclusion: "failure", steps: 11 }],
  stepless: [{ name: "Lint", conclusion: "failure", steps: 0 }],
  skipped: [{ name: "iOS compiles", conclusion: "skipped", steps: 0 }],
};

const PR_STATES: PrState[] = [
  { state: "OPEN", mergeable: "MERGEABLE", mergeStateStatus: "CLEAN" },
  { state: "OPEN", mergeable: "MERGEABLE", mergeStateStatus: "UNSTABLE" },
  { state: "OPEN", mergeable: "MERGEABLE", mergeStateStatus: "BLOCKED" },
  { state: "OPEN", mergeable: "UNKNOWN", mergeStateStatus: "UNKNOWN" },
];

type Case = { run: RunRow | undefined; jobs: string; pr: PrState };

function* every(): Generator<Case> {
  for (const pr of PR_STATES) {
    yield { run: undefined, jobs: "none", pr };
    for (const status of STATUSES) {
      for (const conclusion of CONCLUSIONS) {
        for (const jobs of Object.keys(JOB_SETS)) {
          yield { run: { databaseId: 1, status, conclusion, headSha: "abc" }, jobs, pr };
        }
      }
    }
  }
}

const describeCase = (c: Case) =>
  `run=${c.run ? `${c.run.status}/${c.run.conclusion}` : "absent"} jobs=${c.jobs} pr=${c.pr.mergeStateStatus}`;

describe("what landing may do with every verdict decideVerdict can produce", () => {
  test("a run that is not completed is never handed back", () => {
    for (const c of every()) {
      if (c.run && c.run.status === "completed") continue;
      const v = decideVerdict(c.run, JOB_SETS[c.jobs]);
      const out = landing(c.pr, v);
      assert.notEqual(
        out.action,
        "hand-back",
        `${describeCase(c)} handed a fix round a branch whose run had not finished: ${out.reason}`
      );
    }
  });

  test("a hand-back always names a completed, unsuccessful run", () => {
    for (const c of every()) {
      const v = decideVerdict(c.run, JOB_SETS[c.jobs]);
      if (landing(c.pr, v).action !== "hand-back") continue;
      assert.equal(c.run?.status, "completed", describeCase(c));
      assert.notEqual(c.run?.conclusion, "success", describeCase(c));
    }
  });

  test("every verdict maps to an action the supervisor handles", () => {
    const handled = new Set(["merge", "already-merged", "update-branch", "recheck", "hand-back", "owner"]);
    for (const c of every()) {
      const out = landing(c.pr, decideVerdict(c.run, JOB_SETS[c.jobs]));
      assert.ok(handled.has(out.action), `${describeCase(c)} produced ${out.action}`);
      assert.ok(out.reason, `${describeCase(c)} produced an action with no reason`);
    }
  });

  // The floor. With the guard removed this walk must go red, or it is pinning nothing.
  test("the walk can see the defect it exists for", () => {
    const inFlight = decideVerdict({ databaseId: 1, status: "in_progress", conclusion: null }, []);
    assert.equal(inFlight.waiting, true, "the flag landing reads is what makes this checkable");
    assert.equal(landing(PR_STATES[1], { ...inFlight, waiting: undefined }).action, "hand-back");
  });
});
