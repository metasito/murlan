import { setSoundVolume } from "@/lib/device/feedback";
import { registerBenchScenario } from "../bench";
import { botTable, driveBots } from "../benchTable";

registerBenchScenario("landingSync", async (ctx) => {
  setSoundVolume(1);
  let plays = 0;
  for (let hand = 0; hand < 5 && plays < 40; hand++) {
    await driveBots(ctx, botTable(), 900, (s) => {
      if (s.lastPlayedCombination && s.passCount === 0) plays++;
    });
  }
  await ctx.sleep(500);
});
