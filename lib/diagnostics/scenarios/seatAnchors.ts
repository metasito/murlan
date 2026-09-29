import { SEAT_COUNT_STATES, captureGameState } from "@/lib/captureStates";
import { registerBenchScenario } from "../bench";
import { diag, setRingProbe } from "../index";

const SETTLE_MS = 1500;
const HOLD_MS = 1000;

registerBenchScenario("seatAnchors", async (ctx) => {
  setRingProbe(true);
  try {
    for (const state of SEAT_COUNT_STATES) {
      await ctx.showTable(captureGameState(state));
      await ctx.sleep(SETTLE_MS);
      diag({ k: "seatState", t: performance.now(), id: state.id, of: SEAT_COUNT_STATES.length, hold: HOLD_MS });
      await ctx.sleep(HOLD_MS);
    }
    await ctx.showTable(null);
  } finally {
    setRingProbe(false);
  }
});
