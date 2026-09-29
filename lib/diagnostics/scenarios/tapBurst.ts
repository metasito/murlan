import { setHapticsEnabled, setSoundVolume } from "@/lib/device/feedback";
import { registerBenchScenario } from "../bench";
import { benchTable } from "../benchTable";
import { benchHandles, diag } from "../index";

registerBenchScenario("tapBurst", async (ctx) => {
  const state = benchTable();
  await ctx.showTable(state);
  await ctx.sleep(3000);
  const card = state.players[0].hand[0].id;
  if (!benchHandles.cardPress) throw new Error("no table registered its card press");
  for (const name of ["off", "on"] as const) {
    setSoundVolume(name === "on" ? 1 : 0);
    setHapticsEnabled(name === "on");
    diag({ k: "arm", t: performance.now(), name, phase: "start" });
    ctx.frames(true);
    for (let i = 0; i < 60; i++) {
      diag({ k: "trigger", t: performance.now(), name: "tap" });
      benchHandles.cardPress?.(card);
      await ctx.sleep(167);
    }
    await ctx.sleep(600);
    ctx.frames(false);
    await ctx.sleep(200);
    diag({ k: "arm", t: performance.now(), name, phase: "end" });
  }
  setSoundVolume(1);
  setHapticsEnabled(true);
  await ctx.showTable(null);
});
