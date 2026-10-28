import { registerFramedScenario } from "../bench";
import { botTable, driveBots } from "../benchTable";
import { diag } from "../index";

const SETTLE_MS = 4000;
const STEP_MS = 900;
const WINDOW_MS = 30000;
const FLUSH_MS = 200;
const DEFAULT_MINUTES = 8;

registerFramedScenario("sustained", async (ctx) => {
  const windows = Math.max(2, Math.round((Number(ctx.params.minutes ?? DEFAULT_MINUTES) * 60000) / WINDOW_MS));
  let done = false;
  const bots = (async () => {
    while (!done) await driveBots(ctx, botTable(), STEP_MS, undefined, () => done);
  })();
  try {
    await ctx.sleep(SETTLE_MS);
    for (let i = 0; i < windows; i++) {
      diag({ k: "window", t: performance.now(), i });
      ctx.frames(true);
      await ctx.sleep(WINDOW_MS);
      ctx.frames(false);
      await ctx.sleep(FLUSH_MS);
    }
  } finally {
    done = true;
    ctx.frames(false);
    await bots;
    await ctx.showTable(null);
  }
});
