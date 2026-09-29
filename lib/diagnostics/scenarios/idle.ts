import { registerFramedScenario } from "../bench";

registerFramedScenario("idle", async (ctx) => {
  ctx.frames(true);
  await ctx.sleep(5000);
  ctx.frames(false);
  await ctx.sleep(100);
});
