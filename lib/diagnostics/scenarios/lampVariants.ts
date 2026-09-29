import { CAPTURE_STATES, captureGameState } from "@/lib/captureStates";
import { registerBenchScenario } from "../bench";
import { diag } from "../index";
import { LAMP_SIDES, LAMP_SWAY, legibility } from "../lampLegibility";

/** Past the lamp's glide to the seat and its breath up from the deal. */
const SETTLE_MS = 4000;

registerBenchScenario("lampVariants", async (ctx) => {
  const step = LAMP_SWAY.ms / LAMP_SWAY.samples;
  for (const side of LAMP_SIDES) {
    const state = CAPTURE_STATES.find((s) => s.id === `lamp-${side}`);
    if (!state) throw new Error(`no capture state lamp-${side}`);
    await ctx.showTable(captureGameState(state));
    await ctx.sleep(SETTLE_MS);
    const t0 = performance.now();
    for (let i = 0; i < LAMP_SWAY.samples; i++) {
      await ctx.sleep(Math.max(0, t0 + i * step - performance.now()));
      diag({ k: "lampLegibility", t: performance.now(), side, ratio: legibility(await ctx.feltSample(), side) });
    }
  }
  await ctx.showTable(null);
});
