import { CAPTURE_STATES, captureGameState } from "@/lib/captureStates";
import { registerBenchScenario } from "../bench";
import { diag, FeltDraws } from "../index";

/** Past the lamp's glide to the seat, its breath up from the deal and the felt's cross to its ends. */
const SETTLE_MS = 4000;
/** A window at rest, about a quarter of the sway's period: long enough for a live sway to cross the felt's redraw step many times. */
const WINDOW_MS = 5000;
/** Long enough for the runner to take a screenshot after a `shot` row. */
const SHOT_MS = 2500;
const SHOTS = 2;

registerBenchScenario("restCaptures", async (ctx) => {
  if (!FeltDraws) return;
  for (const state of CAPTURE_STATES) {
    await ctx.showTable(captureGameState(state));
    await ctx.sleep(SETTLE_MS);
    const felt = FeltDraws.felt.get();
    const end = FeltDraws.end.get();
    const frames = FeltDraws.frames.get();
    const rested = FeltDraws.rested.get();
    const t0 = performance.now();
    await ctx.sleep(WINDOW_MS);
    diag({ k: "atRest", t: performance.now(), id: state.id, ms: performance.now() - t0, felt: FeltDraws.felt.get() - felt, end: FeltDraws.end.get() - end, frames: FeltDraws.frames.get() - frames, rested: FeltDraws.rested.get() - rested, lamp: FeltDraws.probe.get() });
    for (let i = 0; i < SHOTS; i++) {
      diag({ k: "shot", t: performance.now(), id: `${state.id}-${i}` });
      await ctx.sleep(SHOT_MS);
    }
  }
  await ctx.showTable(null);
});
