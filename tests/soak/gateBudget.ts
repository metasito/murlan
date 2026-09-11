// tests/soak/gateBudget.ts — what the gated soak may cost, derived rather than chosen.
//
// `opts.minutes * 60_000` is the one deadline in this path `DEADLINE_SCALE` does not
// multiply, and every wait around it is one it does. A budget shared between the two
// is one a slow runner can spend the window's share of, so the timeout is derived
// from the window instead, with the stall allowance beside it scaled.
import { readFileSync } from "node:fs";
import { DEADLINE_SCALE, SLOW_RUNNER_SCALE } from "../helpers/client.ts";

/** `settle`'s cap, so the reserve kept for it and the cap it waits to are one number. */
export const SETTLE_CAP_MS = 4_000;

/**
 * Settles one run can spend a whole cap on, at `chaos: 0`: the loop tests its deadline
 * before it settles, and a second runs after the loop. Chaos adds sleeps this does not
 * model, and the gate runs without it.
 */
const CAPPED_SETTLES = 2;

/**
 * A healthy run outside the window — boot, the DDL, four registrations, four handshakes,
 * teardown. Highest of five local runs: 2598, 2603, 2615, 2898, 5155 ms, the last of them
 * compiling the module graph too. Unpadded: the allowance for a slower machine is `scale`.
 */
const OVERHEAD_MS = 5_200;

/**
 * A round — one loop pass in which a seat acted, which is what `result.moves` counts.
 * Measured locally: 47 of them in a 24,000 ms window, 20 in 10,000 ms.
 */
const ROUND_MS = 512;

/**
 * Rounds the window must fit on the slowest runner budgeted for. Under this a run can take
 * no round at all and red for the clock rather than for the harness, so the gated test
 * observes it — the relation `rejoinFailure` has to `awayWindowOutsideGrace`.
 */
export const MIN_ROUNDS = 4;

/** What a gate may spend playing. Past it this is the search, which belongs to soak.yml. */
const MAX_WINDOW_MS = 12_000;

/**
 * The window the gate plays for. Not scaled: the soak's deadline is wall clock, so a slow
 * runner takes fewer rounds in it rather than longer, and `MIN_ROUNDS` keeps "fewer" over
 * zero. At this window the whole test measures 12,775 / 12,823 / 12,848 ms locally.
 */
export const GATE_PLAY_MS = 10_000;

export interface GateBudget {
  /** What the gated test declares, overriding the suite's `--test-timeout`. */
  timeoutMs: number;
  playMinutes: number;
  unfit: { reason: "too-short" | "too-long"; detail: string } | null;
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
  const floorMs = ROUND_MS * MIN_ROUNDS * SLOW_RUNNER_SCALE;
  // Two ceilings, lower one binding: `suiteMs` is a number this file reads and cannot
  // bound, so alone it is a ratchet — raise `--test-timeout` for an unrelated test and
  // the gate would be permitted a wider window for free.
  const ceilingMs = Math.min(MAX_WINDOW_MS, suiteMs - stallMs);

  let unfit: GateBudget["unfit"] = null;
  if (playMs < floorMs) {
    unfit = {
      reason: "too-short",
      detail:
        `a ${playMs}ms window is under the ${floorMs}ms that ${MIN_ROUNDS} rounds cost on a ` +
        `${SLOW_RUNNER_SCALE}x runner. A run that takes no round reds on the clock, and reads ` +
        `as the harness having stopped playing.`,
    };
  } else if (playMs > ceilingMs) {
    unfit = {
      reason: "too-long",
      detail:
        `a ${playMs}ms window is over the ${ceilingMs}ms this gate may spend — ${MAX_WINDOW_MS}ms, ` +
        `or what is left of the suite's ${suiteMs}ms once a ${stallMs}ms stall is reserved, ` +
        `whichever is less.`,
    };
  }

  return { timeoutMs: playMs + stallMs * scale, playMinutes: playMs / 60_000, unfit };
}

/** The shipped configuration — refused, not returned beside an objection a caller can skip. */
export function gate(): GateBudget {
  const budget = gateBudget(GATE_PLAY_MS, suiteTimeoutMs());
  if (budget.unfit) throw new Error(`soak gate: ${budget.unfit.detail}`);
  return budget;
}
