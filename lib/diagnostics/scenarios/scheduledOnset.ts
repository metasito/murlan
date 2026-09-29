import { event, setSoundVolume } from "@/lib/device/feedback";
import { registerBenchScenario } from "../bench";
import { diag } from "../index";

registerBenchScenario("scheduledOnset", async (ctx) => {
  setSoundVolume(1);
  for (let i = 0; i < 40; i++) {
    const at = performance.now() + 300;
    diag({ k: "trigger", t: at, name: "scheduled" });
    event([{ kind: "turn" }], at);
    await ctx.sleep(1000);
  }
  await ctx.sleep(500);
});
