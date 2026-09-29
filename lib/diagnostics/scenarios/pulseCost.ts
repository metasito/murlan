import { makeMutable } from "react-native-reanimated";
import { scheduleOnUI } from "react-native-worklets";
import { landingPulse, setHapticsEnabled } from "@/lib/device/feedback";
import { registerBenchScenario } from "../bench";
import { diag } from "../index";

const costs = makeMutable<number[]>([]);

function timed(): void {
  "worklet";
  if (typeof performance === "undefined" || typeof performance.now !== "function") {
    costs.value = [...costs.value, NaN];
    return;
  }
  const t = performance.now();
  landingPulse("heavy");
  costs.value = [...costs.value, performance.now() - t];
}

registerBenchScenario("pulseCost", async (ctx) => {
  setHapticsEnabled(true);
  costs.value = [];
  for (let i = 0; i < 21; i++) {
    scheduleOnUI(timed);
    await ctx.sleep(300);
  }
  if (costs.value.some(Number.isNaN)) throw new Error("the UI runtime has no performance.now");
  costs.value.forEach((ms, i) => diag({ k: "pulseCost", t: performance.now(), ms, cold: i === 0 }));
});
