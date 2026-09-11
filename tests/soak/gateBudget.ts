// tests/soak/gateBudget.ts — what the gated soak may cost, derived rather than chosen.
//
// The gate plays for a wall-clock window inside a wall-clock timeout, and the two
// are not made of the same stuff: the window is `opts.minutes * 60_000`, the only
// deadline in the soak path that `DEADLINE_SCALE` does not multiply, while every
// wait around it is scaled. Sharing one fixed budget between them is what lets a
// slow runner spend the window's share, so the timeout is computed from the window
// instead — the window plus a stall allowance that scales, which is the only shape
// where a slower runner cannot eat the margin.
import { readFileSync } from "node:fs";
import { DEADLINE_SCALE, SLOW_RUNNER_SCALE } from "../helpers/client.ts";

/**
 * `settle`'s contract, kept here rather than at its definition so the reserve this
 * budget keeps for it and the cap it actually waits to are one number.
 */
export const SETTLE_QUIET_MS = 250;
export const SETTLE_CAP_MS = 4_000;

/**
 * Settles one run can spend a whole cap on. The loop tests its deadline before it
 * settles, so the last pass can still start one; the second runs after the loop,
 * for the views the oracle reads.
 */
const CAPPED_SETTLES = 2;

/**
 * What a healthy run costs outside the window — boot, the DDL, four registrations,
 * four handshakes, teardown. The highest of five local runs: 2598, 2603, 2615, 2898
 * and 5155 ms, the last of those compiling the module graph as well.
 *
 * Unpadded on purpose. The allowance for a machine slower than this one is `scale`,
 * applied once below, and a pad on top of it would be a second allowance nobody
 * could size.
 */
const OVERHEAD_MS = 5_200;

/** What a turn costs, measured locally: 47 moves in 24,000 ms, and 18 in 9,000 ms. */
const MOVE_MS = 512;

/**
 * Turns the window has to fit before `moves === 0` says something about the harness
 * rather than about the clock. The oracle runs once per turn, so it is also how many
 * settled tables a gated run compares.
 */
const MIN_MOVES = 4;

/**
 * The window the gate plays for. Not scaled — the soak's own deadline is wall clock,
 * so a slow runner takes fewer turns in it rather than longer, and `MIN_MOVES` is
 * what keeps "fewer" above zero.
 *
 * At this window the whole test measures 11,768 / 11,853 / 11,873 ms locally against
 * a 22,200 ms budget: 10.3 s of margin, which is the part of the budget a stall is
 * allowed to spend. On a runner where the scaled waits cost four times as much, the
 * budget grows with them and the margin holds.
 */
export const GATE_PLAY_MS = 9_000;

export interface GateBudget {
  /** What the gated test declares, overriding the suite's `--test-timeout`. */
  timeoutMs: number;
  /** The same window in the unit `runSoak` takes. */
  playMinutes: number;
  /** Why this configuration cannot be gated on, or `null`. */
  unfit: string | null;
}

/** The suite-wide per-test budget, read from the script that sets it. */
export function suiteTimeoutMs(): number {
  const pkg = JSON.parse(
    readFileSync(new URL("../../package.json", import.meta.url), "utf8")
  ) as { scripts?: Record<string, string> };
  const flag = /--test-timeout=(\d+)/.exec(pkg.scripts?.test ?? "");
  if (!flag?.[1]) throw new Error("package.json's test script no longer sets --test-timeout");
  return Number(flag[1]);
}

export function gateBudget(
  playMs: number,
  suiteMs: number,
  scale: number = DEADLINE_SCALE
): GateBudget {
  const stallMs = OVERHEAD_MS + CAPPED_SETTLES * SETTLE_CAP_MS;
  const floorMs = MOVE_MS * MIN_MOVES * SLOW_RUNNER_SCALE;

  let unfit: string | null = null;
  if (playMs < floorMs) {
    unfit =
      `a ${playMs}ms window is under the ${floorMs}ms that ${MIN_MOVES} turns cost on a ` +
      `${SLOW_RUNNER_SCALE}x runner, so a run can end with no turn taken and still be green. ` +
      `The gate's whole claim is that the harness plays; shorten it further and it stops ` +
      `making one.`;
  } else if (playMs + stallMs > suiteMs) {
    unfit =
      `the window plus a ${stallMs}ms stall allowance is ${playMs + stallMs}ms, over the ` +
      `${suiteMs}ms every other test in this suite gets. The gate declares its own timeout, ` +
      `but only to absorb a slow runner — a gate that costs more than the suite's own budget ` +
      `on this machine is asking for a longer run, which belongs in soak.yml.`;
  }

  return { timeoutMs: playMs + stallMs * scale, playMinutes: playMs / 60_000, unfit };
}

export const GATE = gateBudget(GATE_PLAY_MS, suiteTimeoutMs());
