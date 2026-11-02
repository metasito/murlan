import { event, setSoundVolume } from "@/lib/device/feedback";
import { registerBenchScenario } from "../bench";
import { diag } from "../index";

registerBenchScenario("captureProbe", async (ctx) => {
  setSoundVolume(1);
  await ctx.sleep(1000);
  for (let i = 0; i < 20; i++) {
    const at = performance.now() + 300;
    diag({ k: "trigger", t: at, name: "probe" });
    event([{ kind: "turn" }], at);
    await ctx.sleep(1500);
  }
  await ctx.sleep(500);
}, { capture: true });
