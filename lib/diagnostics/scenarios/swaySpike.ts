import type { SpikeConfig } from "@/components/table/spike/SwaySpikeNative";
import { registerFramedScenario } from "../bench";
import { diag } from "../index";
import { probe } from "../probe";

const REST_MS = 20000;

const STEPS: readonly (readonly [string, SpikeConfig])[] = [
  ["rest one layer", { layers: 1, driver: "static", opaqueB: true, pool: "none", offset: 0 }],
  ["rest two layers static", { layers: 2, driver: "static", opaqueB: true, pool: "none", offset: 0 }],
  ["css sway, opaque B", { layers: 2, driver: "css", opaqueB: true, pool: "none", offset: 0 }],
  ["css sway, memoized keyframes", { layers: 2, driver: "css", opaqueB: true, pool: "none", offset: 0, anim: "memo" }],
  ["css sway, 4 keyframes", { layers: 2, driver: "css", opaqueB: true, pool: "none", offset: 0, anim: "short" }],
  ["css sway, translucent B", { layers: 2, driver: "css", opaqueB: false, pool: "none", offset: 0 }],
  ["css sway, paused", { layers: 2, driver: "paused", opaqueB: true, pool: "none", offset: 0 }],
  ["g2 pool glide", { layers: 1, driver: "static", opaqueB: true, pool: "g2", offset: 0 }],
  ["g1 live lit", { layers: 1, driver: "static", opaqueB: true, pool: "g1", offset: 0 }],
  ["css sway, no per-keyframe easing", { layers: 2, driver: "css", opaqueB: true, pool: "none", offset: 0, anim: "noEase" }],
];

registerFramedScenario("spike", async (ctx) => {
  for (const [name, config] of STEPS) {
    await ctx.showSpike!(config);
    await ctx.sleep(1500);
    diag({ k: "spike", t: performance.now(), name, phase: "start", mb: probe.footprintMb() });
    ctx.frames(true);
    await ctx.sleep(REST_MS);
    ctx.frames(false);
    diag({ k: "spike", t: performance.now(), name, phase: "end", mb: probe.footprintMb() });
    await ctx.sleep(300);
  }
  await ctx.showSpike!(null);
});
