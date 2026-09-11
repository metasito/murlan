import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  GATE_PLAY_MS,
  SETTLE_CAP_MS,
  gate,
  gateBudget,
  suiteTimeoutMs,
} from "./soak/gateBudget.ts";
import { SLOW_RUNNER_SCALE } from "./helpers/client.ts";

describe("the gated soak's budget", () => {
  test("the shipped configuration fits", () => {
    assert.equal(gate().playMinutes * 60_000, GATE_PLAY_MS);
  });

  // The window is wall clock and the waits beside it are not, so whatever else
  // moves, the two settles a run can spend a whole cap on have to fit beside the
  // window at the scale they are capped at.
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

  // The floor and the ceiling are one guard: without the first, a window too short
  // to take a turn passes and the gate's own claim goes vacuous.
  test("a window too short to take a turn on a slow runner is refused", () => {
    const oneTurn = 512;
    assert.equal(gateBudget(oneTurn, suiteTimeoutMs(), 1).unfit?.reason, "too-short");
  });

  test("a window wide enough to be the search is refused", () => {
    assert.equal(gateBudget(suiteTimeoutMs(), suiteTimeoutMs(), 1).unfit?.reason, "too-long");
  });

  // The suite's budget is a number this check reads and cannot bound, so it cannot
  // be the only ceiling: raising `--test-timeout` for an unrelated test would widen
  // what the gate is allowed for free.
  test("a wider --test-timeout does not buy the gate a wider window", () => {
    const generous = suiteTimeoutMs() * 10;
    assert.equal(gateBudget(generous / 2, generous, 1).unfit?.reason, "too-long");
  });

  // The module lands unreached otherwise: every check here would stay green over a
  // gated test that had quietly gone back to its own numbers.
  test("the gated test takes both its window and its timeout from here", () => {
    const source = readFileSync(
      new URL("./integration/soakDrivesTheGame.test.ts", import.meta.url),
      "utf8"
    );
    assert.match(source, /^(?!\s*\/\/).*minutes: GATE\.playMinutes/m);
    assert.match(source, /^(?!\s*\/\/).*timeout: GATE\.timeoutMs/m);
  });
});
