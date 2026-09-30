import { Easing } from "react-native-reanimated";
import type { DealLeg } from "./dealSlots.ts";

const DEAL_EASING = Easing.bezierFn(0.22, 0.61, 0.36, 1.0);
const DEAL_SPIN_DEG = 180;

/** Where a leg's back is at `clockMs` on the deal's clock, from the pile; it is drawn only while in the air. */
export function dealFlight(leg: DealLeg, clockMs: number) {
  "worklet";
  const k = Math.min(1, Math.max(0, (clockMs - leg.leaveMs) / leg.flightMs));
  const p = DEAL_EASING(k);
  return { inAir: k > 0 && k < 1, dx: leg.to.dx * p, dy: leg.to.dy * p, rot: DEAL_SPIN_DEG * p };
}

/** A leg's pose at `clockMs` on the deal's clock, drawn only while it is in the air. */
export function dealPose(leg: DealLeg, clockMs: number) {
  "worklet";
  const f = dealFlight(leg, clockMs);
  return {
    opacity: f.inAir ? 1 : 0,
    transform: [{ translateX: f.dx }, { translateY: f.dy }, { rotate: `${f.rot}deg` }],
  };
}
