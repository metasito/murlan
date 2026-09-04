// tests/loopDerive.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { ticketOf, verdictFor, BRANCH } from "../scripts/loop-derive.mjs";

/**
 * The state file these replace failed in one way over and over: it said something that was no
 * longer true. Ticket two inherited ticket one's `VERDICT: LAND` because nothing cleared it, and
 * the gate believed it. Nothing is stored now, so the equivalent question is whether the review
 * found is a review *of this code* — which is what the sha binding decides.
 */
describe("which ticket the work belongs to", () => {
  test("comes from the branch, so it cannot disagree with where you are", () => {
    assert.equal(ticketOf("agent/824-music-delay"), 824);
    assert.equal(ticketOf("agent/55-maestro"), 55);
  });

  test("no ticket off a ticket branch", () => {
    for (const b of ["main", "chore/loop-rebuild", "agent/no-number", "", null]) {
      assert.equal(ticketOf(b as string), null, `${b} should not read as a ticket`);
    }
  });

  test("the pattern is anchored, so `feature/agent/9-x` is not ticket 9", () => {
    assert.equal(BRANCH.test("feature/agent/9-x"), false);
  });
});

describe("whether a review covers the code being pushed", () => {
  const head = "abc1234def5678901234567890123456789012ab";
  const other = "9999999999999999999999999999999999999999";

  test("a LAND naming this head clears it", () => {
    const v = verdictFor([{ body: "VERDICT: LAND abc1234" }], head);
    assert.equal(v?.decision, "LAND");
  });

  // The whole point of the binding: commit again after a review and it stops counting, so there is
  // no way to land a diff the reviewer never saw.
  test("a LAND naming an older head does not", () => {
    assert.equal(verdictFor([{ body: "VERDICT: LAND 9999999" }], head), null);
  });

  test("a HOLD is found, and is not permission", () => {
    const v = verdictFor([{ body: "VERDICT: HOLD abc1234 — the guard exempts its own case" }], head);
    assert.equal(v?.decision, "HOLD");
  });

  test("the latest verdict for this head wins", () => {
    const v = verdictFor(
      [{ body: "VERDICT: HOLD abc1234 — wrong" }, { body: "VERDICT: LAND abc1234" }],
      head
    );
    assert.equal(v?.decision, "LAND");
  });

  test("a comment merely discussing a verdict is not one", () => {
    for (const body of [
      "I think this should be VERDICT: LAND abc1234 personally",
      "LAND abc1234",
      "VERDICT: LAND",
      "VERDICT: MAYBE abc1234",
      "",
    ]) {
      assert.equal(verdictFor([{ body }], head), null, `should not count: ${JSON.stringify(body)}`);
    }
  });

  test("no comments at all is no verdict, not a pass", () => {
    assert.equal(verdictFor([], head), null);
    assert.equal(verdictFor([{ body: "nice work" }], other), null);
  });
});
