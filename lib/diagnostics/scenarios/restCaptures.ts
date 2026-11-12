import { CAPTURE_STATES, captureGameState } from "@/lib/captureStates";
import { mulberry32 } from "@/lib/game/simulate";
import { registerBenchScenario, type BenchContext } from "../bench";
import { botTable, driveBots } from "../benchTable";
import { diag, FeltDraws } from "../index";

/** Past the lamp's glide to the seat, its breath up from the deal and the felt's cross to its ends. */
const SETTLE_MS = 4000;
/** A window at rest, about two thirds of the sway's 7.5 s period: long enough for a live sway to cross the felt's redraw step many times. */
const WINDOW_MS = 5000;
/** Long enough for the runner to see a `shot` row and take a screenshot on a loaded simulator, which can take several seconds. */
const SHOT_MS = 10000;
const SHOTS = 2;
/** A window of bots playing, a card thrown every `PLAY_STEP_MS`: what the felt costs while cards fly over it. */
const PLAY_MS = 10000;
const PLAY_STEP_MS = 900;
const SEED = 2093;

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

/** Every deal and bot choice from one stream, so two builds' runs show the same games. */
function seedRandomness(seed: number): () => void {
  const next = mulberry32(seed);
  const random = Math.random;
  const c = globalThis.crypto as { getRandomValues?: (array: Uint32Array) => Uint32Array } | undefined;
  const values = c?.getRandomValues;
  Math.random = next;
  if (c) {
    c.getRandomValues = (array) => {
      for (let i = 0; i < array.length; i++) array[i] = Math.floor(next() * 0x100000000);
      return array;
    };
  }
  return () => {
    Math.random = random;
    if (c) c.getRandomValues = values;
  };
}

registerBenchScenario("restCaptures", async (ctx) => {
  if (!FeltDraws) return;
  const unseed = seedRandomness(SEED);
  try {
    await captures(ctx);
  } finally {
    unseed();
  }
});

async function captures(ctx: BenchContext): Promise<void> {
  for (const state of CAPTURE_STATES) {
    await ctx.showTable(captureGameState(state));
    await ctx.sleep(SETTLE_MS);
    const draws = drawsSince();
    const t0 = performance.now();
    await ctx.sleep(WINDOW_MS);
    diag({ k: "atRest", t: performance.now(), id: state.id, ms: performance.now() - t0, ...draws() });
    for (let i = 0; i < SHOTS; i++) {
      diag({ k: "shot", t: performance.now(), id: `${state.id}-${i}`, holdMs: SHOT_MS });
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
}
