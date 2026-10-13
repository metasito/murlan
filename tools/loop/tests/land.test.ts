// tools/loop/tests/land.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  landing,
  armArgs,
  disarmArgs,
  deleteBranchArgs,
  branchSurvives,
  type CiVerdict,
  type Landing,
  type PrState,
} from "../land.ts";

const ACTIONS: readonly Landing["action"][] = [
  "arm",
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
    name: "a cancelled run says it was cancelled, not that it ran no steps",
    pr: pr(),
    ci: { ...CANCELLED, reason: "the run was cancelled" },
    action: "recheck",
    reason: /^the run was cancelled$/,
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
    name: "CLEAN arms",
    pr: pr(),
    ci: GREEN,
    action: "arm",
  },
  {
    name: "CLEAN on a red run is handed back rather than armed",
    pr: pr(),
    ci: RED,
    action: "hand-back",
  },
  {
    name: "HAS_HOOKS arms",
    pr: pr({ mergeStateStatus: "HAS_HOOKS" }),
    ci: GREEN,
    action: "arm",
  },
  // UNSTABLE is "mergeable with non-passing commit status", and non-passing includes *queued*.
  // Reaching this arm means the verdict passed the gate for this head, which is the only reading
  // under which a pending check is ignorable.
  {
    name: "UNSTABLE arms, and says that CI was already judged",
    pr: pr({ mergeStateStatus: "UNSTABLE" }),
    ci: GREEN,
    action: "arm",
    reason: /ciVerdict/,
  },
  {
    name: "armed while the required check is pending is a recheck, not the owner's",
    pr: pr({ mergeStateStatus: "BLOCKED", armed: true }),
    ci: { waiting: true },
    action: "recheck",
  },
  {
    name: "armed and BLOCKED under a green gate waits for GitHub's merge",
    pr: pr({ mergeStateStatus: "BLOCKED", armed: true }),
    ci: GREEN,
    action: "recheck",
    reason: /armed/,
  },
  {
    name: "armed and red is still handed back",
    pr: pr({ mergeStateStatus: "BLOCKED", armed: true }),
    ci: RED,
    action: "hand-back",
  },
  {
    name: "BLOCKED and not armed after a green gate is still the owner's",
    pr: pr({ mergeStateStatus: "BLOCKED" }),
    ci: GREEN,
    action: "owner",
  },
  {
    name: "armed and DIRTY is the owner's",
    pr: pr({ mergeStateStatus: "DIRTY", armed: true }),
    ci: GREEN,
    action: "owner",
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
              for (const armed of [false, true]) {
                const d = landing({ state, mergeStateStatus, mergeable, isDraft, armed }, ci);
                assert.ok(
                  ACTIONS.includes(d.action),
                  `${state}/${mergeStateStatus}/${mergeable}/${isDraft}/${armed} answered ${d.action}`,
                );
                assert.ok(!(isDraft && d.action === "arm"), "a draft is never armed");
                assert.ok(!(ci.pass !== true && d.action === "arm"), "only a green gate is armed");
                assert.equal(typeof d.reason, "string");
                assert.ok(d.reason.length > 0);
                seen += 1;
              }
            }
          }
        }
      }
    }
    assert.equal(seen, states.length * statuses.length * mergeables.length * verdicts.length * 4);
  });

  test("no open pull request is ever abandoned without a person or a fresh session", () => {
    const terminal = ["owner", "hand-back"];
    for (const mergeStateStatus of ["SOMETHING_NEW", "DRAFT", ""]) {
      const d = landing(pr({ mergeStateStatus }), GREEN);
      assert.ok(!terminal.includes(d.action), `${mergeStateStatus} answered ${d.action}`);
    }
  });
});

describe("armArgs and disarmArgs", () => {
  test("arm pins the head, with a merge commit", () => {
    assert.deepEqual(armArgs("metasito/murlan", 7, "abc"), [
      "pr", "merge", "7", "--repo", "metasito/murlan", "--auto", "--merge", "--match-head-commit", "abc",
    ]);
  });

  test("arm never squashes, rebases or forces", () => {
    const args = armArgs("metasito/murlan", 42, "abc");
    for (const flag of ["--squash", "--rebase", "--admin"]) assert.ok(!args.includes(flag), flag);
  });

  test("disarm", () => {
    assert.deepEqual(disarmArgs("metasito/murlan", 7), ["pr", "merge", "7", "--repo", "metasito/murlan", "--disable-auto"]);
  });
});

describe("deleting a merged branch", () => {
  test("deletes the ref on origin, slashes and all", () => {
    assert.deepEqual(deleteBranchArgs("o/r", "agent/958-persist"), ["api", "-X", "DELETE", "repos/o/r/git/refs/heads/agent/958-persist"]);
  });

  test("no ls-remote output means the branch is gone; a ref line means it survived", () => {
    for (const out of ["", "\n", "  \n"]) assert.equal(branchSurvives(out), false);
    assert.equal(branchSurvives("9f1c2d3e4b5a67890abcdef1234567890abcdef1\trefs/heads/agent/958-persist\n"), true);
  });
});
