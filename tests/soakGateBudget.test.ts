import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  GATE,
  GATE_PLAY_MS,
  SETTLE_CAP_MS,
  gateBudget,
  suiteTimeoutMs,
} from "./soak/gateBudget.ts";
import { SLOW_RUNNER_SCALE } from "./helpers/client.ts";

describe("the gated soak's budget", () => {
  test("the shipped configuration fits", () => {
    assert.equal(GATE.unfit, null);
    assert.equal(GATE.playMinutes * 60_000, GATE_PLAY_MS);
  });

  // What timed the gate out was a play window that does not scale sharing a
  // fixed budget with waits that do. Whatever else moves, the two settles a run
  // can spend a full cap on have to fit beside the window at the scale they are
  // capped at.
  test("it leaves the settle caps free beside the play window, at every scale", () => {
    for (const scale of [1, SLOW_RUNNER_SCALE]) {
      const budget = gateBudget(GATE_PLAY_MS, suiteTimeoutMs(), scale);
      assert.ok(
        budget.timeoutMs - GATE_PLAY_MS >= 2 * SETTLE_CAP_MS * scale,
        `at scale ${scale} the budget leaves ${budget.timeoutMs - GATE_PLAY_MS}ms beside the ` +
          `window, and two settles can cap at ${2 * SETTLE_CAP_MS * scale}ms`
      );
    }
  });

  // The floor and the ceiling are the same guard: one refuses a window so short
  // the gate's own claim goes vacuous, the other a window that has outgrown a
  // pull request and belongs in soak.yml. A budget with only the second half is
  // satisfied by a run that never takes a turn.
  test("a window too short to take a turn on a slow runner is refused", () => {
    const oneTurn = 512;
    assert.match(
      gateBudget(oneTurn, suiteTimeoutMs(), 1).unfit ?? "",
      /under the \d+ms that \d+ turns cost/
    );
  });

  test("a window that outgrows the suite's own per-test budget is refused", () => {
    assert.match(
      gateBudget(suiteTimeoutMs(), suiteTimeoutMs(), 1).unfit ?? "",
      /over the \d+ms every other test in this suite gets/
    );
  });

  // The module lands unreached otherwise: every check here would stay green over
  // a gated test that had quietly gone back to its own numbers.
  test("the gated test takes both its window and its timeout from here", () => {
    const source = readFileSync(
      new URL("./integration/soakDrivesTheGame.test.ts", import.meta.url),
      "utf8"
    );
    assert.match(source, /minutes: GATE\.playMinutes/);
    assert.match(source, /timeout: GATE\.timeoutMs/);
  });
});
