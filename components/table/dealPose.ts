// The lantern mockup's `dealRun` and `flyBack` (tests/e2e/fixtures/lantern-table/index.html).
//
// JSX-free, runtime imports relative — docs/agents/checks.md, "Node's TypeScript loader".
import type { DealLeg } from "./dealSlots.ts";

const DEAL_LIFT = 18;
const DEAL_FROM_DEG = -20;
const HAND_FROM_SCALE = 0.8;
const BACK_SHRINK = 0.1;

export function dealEase(k: number): number {
  "worklet";
  return 1 - Math.pow(1 - k, 3);
}

/** The viewer's card at eased progress `e`, turning into its resting `restRot`. */
export function handDealArc(e: number, restRot: number) {
  "worklet";
  return {
    lift: DEAL_LIFT * Math.sin(Math.PI * e),
    rot: restRot * e + DEAL_FROM_DEG * (1 - e),
    scale: HAND_FROM_SCALE + (1 - HAND_FROM_SCALE) * e,
  };
}

const BREATH_SWELL = 0.006;

/** The felt's scale `sinceMs` after the deal's onset: one breath over `breathMs`, the mockup's `dealRun`. */
export function dealBreath(sinceMs: number, breathMs: number): number {
  "worklet";
  const k = sinceMs / breathMs;
  return k > 0 && k < 1 ? 1 + BREATH_SWELL * Math.sin(Math.PI * k) : 1;
}

/** An opponent's back at eased progress `e`, turning into its fan's `restRot`. */
export function backDealArc(e: number, restRot: number) {
  "worklet";
  return { rot: restRot * e, scale: 1 - BACK_SHRINK * e };
}

/** Where a leg's back is at `clockMs` on the deal's clock, from the pile; it is drawn only while in the air. */
export function dealFlight(leg: DealLeg, clockMs: number) {
  "worklet";
  const k = Math.min(1, Math.max(0, (clockMs - leg.leaveMs) / leg.flightMs));
  const e = dealEase(k);
  const arc = backDealArc(e, leg.to.rot);
  return { inAir: k > 0 && k < 1, dx: leg.to.dx * e, dy: leg.to.dy * e, rot: arc.rot, scale: arc.scale };
}

/** A leg's pose at `clockMs` on the deal's clock, drawn only while it is in the air. */
export function dealPose(leg: DealLeg, clockMs: number) {
  "worklet";
  const f = dealFlight(leg, clockMs);
  return {
    opacity: f.inAir ? 1 : 0,
    transform: [{ translateX: f.dx }, { translateY: f.dy }, { rotate: `${f.rot}deg` }, { scale: f.scale }],
  };
}
