// tools/loop/tests/land.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  landing,
  mergeArgs,
  branchSurvives,
  type CiVerdict,
  type Landing,
  type PrState,
} from "../land.ts";

const ACTIONS: readonly Landing["action"][] = [
  "merge",
  "already-merged",
  "update-branch",
  "recheck",
  "hand-back",
  "owner",
  "ready",
];

const pr = (over: Partial<PrState> = {}): PrState => ({
  state: "OPEN",
  mergeable: "MERGEABLE",
  mergeStateStatus: "CLEAN",
  ...over,
});

const GREEN: CiVerdict = { pass: true };
const RED: CiVerdict = { pass: false, failedStep: "Browser tests", output: "expect(received)…" };
const NAMELESS: CiVerdict = { pass: false };
// What a merged branch's own run reads: ci.yml's concurrency group stops it when the merge lands.
const CANCELLED: CiVerdict = { pass: false, infrastructure: true };
const SILENT: CiVerdict = {};

interface Case {
  name: string;
  pr: PrState;
  ci: CiVerdict;
  action: Landing["action"];
  reason?: RegExp;
}

// Every merge state named in the function, crossed with the verdicts that change the answer, plus
// values the function names nowhere. A merged pull request answers UNKNOWN on both mergeability
// fields, and so does one GitHub has not finished computing — the same two values for "done" and
// "not yet", which is why `state` is read first.
const cases: Case[] = [
  {
    name: "a MERGED pull request is landed before CI is consulted",
    pr: pr({ state: "MERGED", mergeable: "UNKNOWN", mergeStateStatus: "UNKNOWN" }),
    ci: CANCELLED,
    action: "already-merged",
  },
  {
    name: "a MERGED pull request is landed under a plainly red verdict too",
    pr: pr({ state: "MERGED", mergeable: "UNKNOWN", mergeStateStatus: "UNKNOWN" }),
    ci: RED,
    action: "already-merged",
  },
  {
    name: "a MERGED pull request is landed under no verdict at all",
    pr: pr({ state: "MERGED", mergeable: "UNKNOWN", mergeStateStatus: "UNKNOWN" }),
    ci: SILENT,
    action: "already-merged",
  },
  {
    name: "a CLOSED pull request is the owner's",
    pr: pr({ state: "CLOSED", mergeable: "UNKNOWN", mergeStateStatus: "UNKNOWN" }),
    ci: GREEN,
    action: "owner",
    reason: /closed without merging/,
  },
  {
    name: "an unrecognised pull request state is a reading, so it asks again",
    pr: pr({ state: "LOCKED" }),
    ci: GREEN,
    action: "recheck",
    reason: /LOCKED/,
  },
  {
    name: "an empty pull request state asks again",
    pr: pr({ state: "" }),
    ci: GREEN,
    action: "recheck",
  },
  {
    name: "a stepless run says nothing about the diff, so it asks again",
    pr: pr(),
    ci: CANCELLED,
    action: "recheck",
    reason: /zero steps/,
  },
  {
    name: "CONFLICTING is the owner's even when CI is green",
    pr: pr({ mergeable: "CONFLICTING" }),
    ci: GREEN,
    action: "owner",
    reason: /conflicts with main/,
  },
  {
    name: "CONFLICTING is the owner's rather than a fix round when CI is red",
    pr: pr({ mergeable: "CONFLICTING" }),
    ci: RED,
    action: "owner",
  },
  {
    // ci.yml cancels a superseded push, so this is the ordinary shape of a conflicted branch that
    // was pushed to twice, not a rare one. Read as infrastructure it spends every retry round and
    // then reports a sick runner.
    name: "CONFLICTING is the owner's even when the run was cancelled",
    pr: pr({ mergeable: "CONFLICTING" }),
    ci: CANCELLED,
    action: "owner",
    reason: /conflicts with main/,
  },
  {
    name: "red CI on a clean branch is handed back, named",
    pr: pr(),
    ci: RED,
    action: "hand-back",
    reason: /Browser tests/,
  },
  {
    name: "red CI with no step named still says so",
    pr: pr(),
    ci: NAMELESS,
    action: "hand-back",
    reason: /an unnamed step/,
  },
  {
    name: "a verdict that claims nothing is not a pass",
    pr: pr(),
    ci: SILENT,
    action: "hand-back",
  },
  // The pull request reads UNSTABLE the moment one job goes red, while the rest are still running.
  // Handed back there, the fix round gets no failed step and no log — three empty rounds and a park.
  {
    name: "a run that has not finished is asked again, never handed back",
    pr: pr({ mergeStateStatus: "UNSTABLE" }),
    ci: { pass: false, waiting: true, reason: "run is still in_progress" },
    action: "recheck",
    reason: /still in_progress/,
  },
  {
    name: "mergeable UNKNOWN asks again even when the merge state reads CLEAN",
    pr: pr({ mergeable: "UNKNOWN" }),
    ci: GREEN,
    action: "recheck",
    reason: /computing mergeability/,
  },
  {
    name: "mergeStateStatus UNKNOWN asks again",
    pr: pr({ mergeStateStatus: "UNKNOWN" }),
    ci: GREEN,
    action: "recheck",
  },
  {
    name: "BEHIND updates the branch",
    pr: pr({ mergeStateStatus: "BEHIND" }),
    ci: GREEN,
    action: "update-branch",
  },
  {
    name: "BLOCKED is the owner's, named",
    pr: pr({ mergeStateStatus: "BLOCKED" }),
    ci: GREEN,
    action: "owner",
    reason: /BLOCKED/,
  },
  {
    name: "DIRTY is the owner's, named",
    pr: pr({ mergeStateStatus: "DIRTY" }),
    ci: GREEN,
    action: "owner",
    reason: /DIRTY/,
  },
  {
    name: "CLEAN merges",
    pr: pr(),
    ci: GREEN,
    action: "merge",
  },
  {
    name: "CLEAN on a red run is handed back rather than merged",
    pr: pr(),
    ci: RED,
    action: "hand-back",
  },
  {
    name: "HAS_HOOKS merges",
    pr: pr({ mergeStateStatus: "HAS_HOOKS" }),
    ci: GREEN,
    action: "merge",
  },
  // UNSTABLE is "mergeable with non-passing commit status", and non-passing includes *queued*. gh
  // merges it on the spot. Reaching this arm means the verdict passed the run for this head, which
  // is the only reading under which a pending check is ignorable.
  {
    name: "UNSTABLE merges, and says that CI was already judged",
    pr: pr({ mergeStateStatus: "UNSTABLE" }),
    ci: GREEN,
    action: "merge",
    reason: /ciVerdict/,
  },
  {
    name: "UNSTABLE on a red run is handed back",
    pr: pr({ mergeStateStatus: "UNSTABLE" }),
    ci: RED,
    action: "hand-back",
  },
  // A merge state this function has never seen is not a verdict. Anything terminal here leaves
  // `in-progress` on the issue, and `next-ticket.mjs` skips a labelled ticket forever.
  {
    name: "an unrecognised merge state names itself and asks again",
    pr: pr({ mergeStateStatus: "SOMETHING_NEW" }),
    ci: GREEN,
    action: "recheck",
    reason: /SOMETHING_NEW/,
  },
  {
    name: "DRAFT asks again",
    pr: pr({ mergeStateStatus: "DRAFT" }),
    ci: GREEN,
    action: "recheck",
    reason: /DRAFT/,
  },
  {
    name: "a green draft is marked ready, never merged",
    pr: pr({ mergeStateStatus: "DRAFT", isDraft: true }),
    ci: GREEN,
    action: "ready",
  },
  {
    name: "a red draft is still a fix round",
    pr: pr({ mergeStateStatus: "DRAFT", isDraft: true }),
    ci: RED,
    action: "hand-back",
  },
  {
    name: "a draft whose run is going waits for it",
    pr: pr({ mergeStateStatus: "DRAFT", isDraft: true }),
    ci: { waiting: true, reason: "still in_progress" },
    action: "recheck",
  },
  {
    name: "an empty merge state asks again",
    pr: pr({ mergeStateStatus: "" }),
    ci: GREEN,
    action: "recheck",
  },
];

describe("landing", () => {
  for (const c of cases) {
    test(c.name, () => {
      const d = landing(c.pr, c.ci);
      assert.equal(d.action, c.action);
      if (c.reason) assert.match(d.reason, c.reason);
      assert.ok(d.reason.length > 0);
    });
  }

  // The point of making the function total: no input reaches an unhandled path, and no input is
  // answered with silence. Asserted over the cross-product rather than over a list of cases,
  // because the values that strand a ticket are the ones nobody thought to write down.
  test("every combination answers with one of the seven actions and never throws", () => {
    const states = ["OPEN", "MERGED", "CLOSED", "LOCKED", ""];
    const statuses = ["CLEAN", "HAS_HOOKS", "UNSTABLE", "BEHIND", "BLOCKED", "DIRTY", "UNKNOWN", "DRAFT", ""];
    const mergeables = ["MERGEABLE", "CONFLICTING", "UNKNOWN", ""];
    const verdicts = [GREEN, RED, NAMELESS, CANCELLED, SILENT];

    let seen = 0;
    for (const state of states) {
      for (const mergeStateStatus of statuses) {
        for (const mergeable of mergeables) {
          for (const ci of verdicts) {
            for (const isDraft of [false, true]) {
              const d = landing({ state, mergeStateStatus, mergeable, isDraft }, ci);
              assert.ok(
                ACTIONS.includes(d.action),
                `${state}/${mergeStateStatus}/${mergeable}/${isDraft} answered ${d.action}`,
              );
              assert.ok(!(isDraft && d.action === "merge"), "a draft is never merged");
              assert.equal(typeof d.reason, "string");
              assert.ok(d.reason.length > 0);
              seen += 1;
            }
          }
        }
      }
    }
    assert.equal(seen, states.length * statuses.length * mergeables.length * verdicts.length * 2);
  });

  test("no open pull request is ever abandoned without a person or a fresh session", () => {
    const terminal = ["owner", "hand-back"];
    for (const mergeStateStatus of ["SOMETHING_NEW", "DRAFT", ""]) {
      const d = landing(pr({ mergeStateStatus }), GREEN);
      assert.ok(!terminal.includes(d.action), `${mergeStateStatus} answered ${d.action}`);
    }
  });
});

describe("mergeArgs", () => {
  test("merges the cleared head with a merge commit and deletes the branch", () => {
    assert.deepEqual(mergeArgs("o/r", 7, "abc"), [
      "pr", "merge", "7", "--repo", "o/r", "--merge", "--delete-branch", "--match-head-commit", "abc",
    ]);
  });

  // The floor. Asserted as absences because a merge that needs forcing is a decision, and
  // `--squash` throws away the branch history a later bisect reads.
  test("never squashes, rebases or forces", () => {
    const args = mergeArgs("metasito/murlan", 42, "abc");
    assert.ok(!args.includes("--squash"));
    assert.ok(!args.includes("--rebase"));
    assert.ok(!args.includes("--admin"));
  });
});

describe("branchSurvives", () => {
  test("no output means the remote branch is gone", () => {
    assert.equal(branchSurvives(""), false);
    assert.equal(branchSurvives("\n"), false);
    assert.equal(branchSurvives("  \n"), false);
  });

  test("a ref line means --delete-branch did not take", () => {
    const line = "9f1c2d3e4b5a67890abcdef1234567890abcdef1\trefs/heads/agent/958-persist-vacated-seats\n";
    assert.equal(branchSurvives(line), true);
  });
});
