// tests/e2eAiSuspend.test.ts — the suspend knob has no path into a real game.
//
// The knob CLAUDE.md's "No self-defeating safeguards" invariant is written
// against: a guard needs a floor as well as a trigger. This pins both — that
// the flag actually suspends when the e2e build set it, and that it is inert
// whenever that build did not, regardless of what the flag itself says.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { shouldSuspendAI } from "../lib/e2eAiSuspend.ts";

describe("shouldSuspendAI", () => {
  test("holds only inside a build the e2e harness produced, with the flag set", () => {
    assert.equal(shouldSuspendAI(true, "1"), true);
  });

  test("dev and production never read the flag, whatever it holds", () => {
    assert.equal(shouldSuspendAI(false, "1"), false, "a stray flag must not suspend a real game");
    assert.equal(shouldSuspendAI(false, null), false);
  });

  test("an e2e build with no flag written plays on as it always has", () => {
    assert.equal(shouldSuspendAI(true, null), false);
    assert.equal(shouldSuspendAI(true, "0"), false);
  });
});
