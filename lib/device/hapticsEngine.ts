import { makeMutable } from "react-native-reanimated";
import { scheduleOnUI } from "react-native-worklets";
import { triggerHaptics, type HapticType } from "react-native-turbo-haptics";
import { DIAGNOSTICS, diag } from "@/lib/diagnostics";

export type TapHaptic = "selection" | "light" | "medium" | "heavy" | "rigid" | "success" | "error" | "warn";
export type PulseStrength = "light" | "medium" | "heavy" | "rigid";

const TYPES: Record<TapHaptic, HapticType> = {
  selection: "selection",
  light: "impactLight",
  medium: "impactMedium",
  heavy: "impactHeavy",
  rigid: "rigid",
  success: "notificationSuccess",
  error: "notificationError",
  warn: "notificationWarning",
};
const gate = makeMutable(true);
const LATE_MS = 10;

export function setHapticsGate(on: boolean): void {
  gate.value = on;
}

export function pulse(strength: PulseStrength): void {
  "worklet";
  if (gate.value) triggerHaptics(TYPES[strength]);
}

function tapLater(type: HapticType, ms: number): void {
  "worklet";
  setTimeout(() => {
    if (gate.value) triggerHaptics(type);
  }, ms);
}

export function tap(kind: TapHaptic, at?: number): void {
  const wait = at === undefined ? 0 : at - performance.now();
  if (wait < -LATE_MS) return;
  if (DIAGNOSTICS) diag({ k: "haptic", t: performance.now(), kind, at: at ?? performance.now() });
  if (wait > 0) scheduleOnUI(tapLater, TYPES[kind], wait);
  else if (gate.value) triggerHaptics(TYPES[kind]);
}
