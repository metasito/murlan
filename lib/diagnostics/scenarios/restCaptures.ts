import { CAPTURE_STATES, captureGameState } from "@/lib/captureStates";
import { registerBenchScenario } from "../bench";
import { botTable, driveBots } from "../benchTable";
import { diag, FeltDraws } from "../index";

/** Past the lamp's glide to the seat, its breath up from the deal and the felt's cross to its ends. */
const SETTLE_MS = 4000;
/** A window at rest, about two thirds of the sway's 7.5 s period: long enough for a live sway to cross the felt's redraw step many times. */
const WINDOW_MS = 5000;
/** Long enough for the runner to take a screenshot after a `shot` row. */
const SHOT_MS = 2500;
const SHOTS = 2;
/** A window of bots playing, a card thrown every `PLAY_STEP_MS`: what the felt costs while cards fly over it. */
const PLAY_MS = 10000;
const PLAY_STEP_MS = 900;

function drawsSince(): () => { felt: number; end: number; frames: number; rested: number } {
  const counts = FeltDraws!;
  const from = { felt: counts.felt.get(), end: counts.end.get(), frames: counts.frames.get(), rested: counts.rested.get() };
  return () => ({
    felt: counts.felt.get() - from.felt,
    end: counts.end.get() - from.end,
    frames: counts.frames.get() - from.frames,
    rested: counts.rested.get() - from.rested,
  });
}

registerBenchScenario("restCaptures", async (ctx) => {
  if (!FeltDraws) return;
  for (const state of CAPTURE_STATES) {
    await ctx.showTable(captureGameState(state));
    await ctx.sleep(SETTLE_MS);
    const draws = drawsSince();
    const t0 = performance.now();
    await ctx.sleep(WINDOW_MS);
    diag({ k: "atRest", t: performance.now(), id: state.id, ms: performance.now() - t0, ...draws() });
    for (let i = 0; i < SHOTS; i++) {
      diag({ k: "shot", t: performance.now(), id: `${state.id}-${i}` });
      await ctx.sleep(SHOT_MS);
    }
  }
  const table = botTable();
  await ctx.showTable(table);
  await ctx.sleep(SETTLE_MS);
  const draws = drawsSince();
  const t0 = performance.now();
  let plays = 0;
  const count = (s: { lastPlayedCombination?: unknown; passCount: number }) => {
    if (s.lastPlayedCombination && s.passCount === 0) plays++;
  };
  await driveBots(ctx, table, PLAY_STEP_MS, count, () => performance.now() - t0 >= PLAY_MS);
  diag({ k: "inPlay", t: performance.now(), ms: performance.now() - t0, plays, ...draws() });
  await ctx.showTable(null);
});
