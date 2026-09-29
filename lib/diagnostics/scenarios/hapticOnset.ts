import { makeMutable } from "react-native-reanimated";
import { scheduleOnUI } from "react-native-worklets";
import { landingPulse, setHapticsEnabled } from "@/lib/device/feedback";
import { registerBenchScenario } from "../bench";
import { diag, jsFromWall } from "../index";
import { probe } from "../probe";

const stamps = makeMutable<number[]>([]);

function fire(): void {
  "worklet";
  stamps.value = [...stamps.value, Date.now()];
  landingPulse("heavy");
}

registerBenchScenario("hapticOnset", async (ctx) => {
  setHapticsEnabled(true);
  stamps.value = [];
  if (!probe.startMotion()) throw new Error("no accelerometer");
  await ctx.sleep(1000);
  for (let i = 0; i < 30; i++) {
    scheduleOnUI(fire);
    await ctx.sleep(1000);
  }
  probe.stopMotion();
  const toJs = jsFromWall();
  for (const wall of stamps.value) diag({ k: "trigger", t: toJs(wall), name: "pulse" });
});
