import { Easing } from "react-native-reanimated";
import type { DealLeg } from "./dealSlots.ts";

const DEAL_EASING = Easing.bezierFn(0.22, 0.61, 0.36, 1.0);
const DEAL_SPIN_DEG = 180;

/** A leg's pose at `clockMs` on the deal's clock, drawn only while it is in the air. */
export function dealPose(leg: DealLeg, clockMs: number) {
  "worklet";
  const k = Math.min(1, Math.max(0, (clockMs - leg.leaveMs) / leg.flightMs));
  const p = DEAL_EASING(k);
  return {
    opacity: k > 0 && k < 1 ? 1 : 0,
    transform: [{ translateX: leg.to.dx * p }, { translateY: leg.to.dy * p }, { rotate: `${DEAL_SPIN_DEG * p}deg` }],
  };
}
