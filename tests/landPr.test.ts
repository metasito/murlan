// tests/landPr.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { decideLanding, mergeArgs } from "../lib/loop/land.ts";

describe("deciding how to land a green pull request", () => {
  test("a clean pull request merges", () => {
    assert.equal(decideLanding({ mergeStateStatus: "CLEAN", mergeable: "MERGEABLE" }).action, "merge");
  });

  // Merging while BEHIND builds a tree no run has tested, so ci.yml stops skipping the main push
  // and the whole suite runs again, billed again.
  test("BEHIND updates the branch instead of merging", () => {
    const d = decideLanding({ mergeStateStatus: "BEHIND", mergeable: "MERGEABLE" });
    assert.equal(d.action, "update-branch");
  });

  test("a conflict stops rather than forcing", () => {
    assert.equal(decideLanding({ mergeStateStatus: "DIRTY", mergeable: "CONFLICTING" }).action, "stop");
  });

  test("BLOCKED stops", () => {
    assert.equal(decideLanding({ mergeStateStatus: "BLOCKED", mergeable: "MERGEABLE" }).action, "stop");
  });

  // The floor: an unfamiliar state must not fall through to a merge. Defaulting to the destructive
  // action on a value nobody anticipated is how a force-merge happens by accident.
  test("an unrecognised state stops", () => {
    assert.equal(decideLanding({ mergeStateStatus: "SOMETHING_NEW", mergeable: "UNKNOWN" }).action, "stop");
  });

  test("the merge is a real merge, deletes the branch, and never squashes or forces", () => {
    const args = mergeArgs("metasito/murlan", 42);
    assert.ok(args.includes("--merge"));
    assert.ok(args.includes("--delete-branch"));
    assert.ok(!args.includes("--squash"));
    assert.ok(!args.includes("--rebase"));
    assert.ok(!args.includes("--admin"));
  });
});
