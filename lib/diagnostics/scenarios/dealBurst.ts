import { registerFramedScenario } from "../bench";
import { botTable } from "../benchTable";
import { diag } from "../index";

const DEALS = 10;
const GAP_MS = 700;
const DEAL_MS = 1300;
const FLUSH_MS = 200;

registerFramedScenario("dealBurst", async (ctx) => {
  try {
    for (let i = 0; i < DEALS; i++) {
      await ctx.showTable(null);
      await ctx.sleep(GAP_MS);
      diag({ k: "window", t: performance.now(), i });
      ctx.frames(true);
      await ctx.showTable(botTable());
      await ctx.sleep(DEAL_MS);
      ctx.frames(false);
      await ctx.sleep(FLUSH_MS);
    }
  } finally {
    ctx.frames(false);
    await ctx.showTable(null);
  }
});
