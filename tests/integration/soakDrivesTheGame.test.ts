// tests/integration/soakDrivesTheGame.test.ts — the soak still plays.
//
// The soak itself is a search, and a search belongs nowhere near a pull
// request's critical path: a run that finds something is a run that fails, and
// gating on it would redden `main` for a defect the branch never introduced.
// What *is* safe to gate on is that the harness still drives the game at all —
// a soak that silently stopped playing would report "no disagreement" forever
// and nobody would notice.
//
// So: no chaos, a few seconds, and the only claim is that cards left hands.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { hasDatabase, skipMessage } from "../helpers/testServer.ts";
import { runSoak } from "../soak/soak.ts";

describe("the soak harness drives a real game", {
  skip: hasDatabase() ? false : skipMessage(),
}, () => {
  let restore: (() => void) | undefined;

  before(() => {
    // The runner's own progress lines would drown the test output.
    const original = console.log;
    console.log = () => {};
    restore = () => {
      console.log = original;
    };
  });
  after(() => restore?.());

  test("it deals, plays legal moves, and the table agrees throughout", async () => {
    const result = await runSoak(
      { seats: 4, minutes: 0.4, seed: 20260829, chaos: 0 },
      () => {}
    );

    assert.ok(
      result.moves > 0,
      "the harness took no turns at all — it is no longer playing the game"
    );
    assert.deepEqual(
      result.violations,
      [],
      `a quiet four-handed table disagreed with itself: ${JSON.stringify(result.violations)}`
    );
    assert.equal(result.chaosEvents.length, 0, "chaos was off for this run");
  });
});
