// tests/land.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { decideLanding, mergeArgs } from "../lib/loop/land.ts";

const pr = (over: Partial<Parameters<typeof decideLanding>[0]> = {}) => ({
  state: "OPEN",
  mergeable: "MERGEABLE",
  mergeStateStatus: "CLEAN",
  ...over,
});

describe("decideLanding", () => {
  // A merged pull request answers UNKNOWN/UNKNOWN on both fields. Measured on #985, #986,
  // #994 and #996. Read `state` before either of them or a landed ticket reads as unlandable.
  test("a MERGED pull request is already merged, whatever its merge state says", () => {
    const d = decideLanding(pr({ state: "MERGED", mergeable: "UNKNOWN", mergeStateStatus: "UNKNOWN" }));
    assert.equal(d.action, "already-merged");
  });

  test("a CLOSED pull request is not a merge and not a retry", () => {
    const d = decideLanding(pr({ state: "CLOSED", mergeable: "UNKNOWN", mergeStateStatus: "UNKNOWN" }));
    assert.equal(d.action, "stop");
    assert.match(d.reason, /closed without merging/);
  });

  test("an open pull request still being computed asks again", () => {
    const d = decideLanding(pr({ mergeable: "UNKNOWN", mergeStateStatus: "UNKNOWN" }));
    assert.equal(d.action, "recheck");
  });

  test("mergeable UNKNOWN asks again even when the merge state reads CLEAN", () => {
    const d = decideLanding(pr({ mergeable: "UNKNOWN", mergeStateStatus: "CLEAN" }));
    assert.equal(d.action, "recheck");
  });

  test("CONFLICTING stops", () => {
    assert.equal(decideLanding(pr({ mergeable: "CONFLICTING" })).action, "stop");
  });

  test("BEHIND updates the branch", () => {
    assert.equal(decideLanding(pr({ mergeStateStatus: "BEHIND" })).action, "update-branch");
  });

  test("CLEAN merges", () => {
    assert.equal(decideLanding(pr()).action, "merge");
  });

  test("HAS_HOOKS merges", () => {
    assert.equal(decideLanding(pr({ mergeStateStatus: "HAS_HOOKS" })).action, "merge");
  });

  // UNSTABLE means "mergeable with non-passing commit status", and non-passing includes
  // *queued*. gh merges it on the spot. The CI verdict is read before this function is
  // called at all, so reaching here on UNSTABLE means the suite was green and a non-required
  // check is pending — which is the only reading under which merging is right.
  test("UNSTABLE merges, and says that CI was already judged", () => {
    const d = decideLanding(pr({ mergeStateStatus: "UNSTABLE" }));
    assert.equal(d.action, "merge");
    assert.match(d.reason, /ciVerdict/);
  });

  test("an unrecognised state names itself and stops", () => {
    const d = decideLanding(pr({ mergeStateStatus: "SOMETHING_NEW" }));
    assert.equal(d.action, "stop");
    assert.match(d.reason, /SOMETHING_NEW/);
  });
});

describe("mergeArgs", () => {
  test("merges with a merge commit and deletes the branch", () => {
    assert.deepEqual(mergeArgs("o/r", 7), ["pr", "merge", "7", "--repo", "o/r", "--merge", "--delete-branch"]);
  });

  // The floor. Asserted as absences because a merge that needs forcing is a decision, and
  // `--squash` throws away the branch history a later bisect reads.
  test("never squashes, rebases or forces", () => {
    const args = mergeArgs("metasito/murlan", 42);
    assert.ok(!args.includes("--squash"));
    assert.ok(!args.includes("--rebase"));
    assert.ok(!args.includes("--admin"));
  });
});
