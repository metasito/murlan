import { makeMutable } from "react-native-reanimated";

export type TapHaptic = "selection" | "light" | "medium" | "heavy" | "rigid" | "success" | "error" | "warn";
export type PulseStrength = "light" | "medium" | "heavy" | "rigid";

const PATTERNS: Record<TapHaptic, number[]> = {
  success: [40, 100, 40],
  warn: [50, 100, 50],
  error: [60, 100, 60, 100, 60],
  light: [40],
  medium: [50],
  heavy: [60],
  rigid: [45],
  selection: [50],
};
const gate = makeMutable(true);
const LATE_MS = 10;

export function setHapticsGate(on: boolean): void {
  gate.value = on;
}

function switchClick(): void {
  try {
    const label = document.createElement("label");
    label.ariaHidden = "true";
    label.style.display = "none";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.setAttribute("switch", "");
    label.appendChild(input);
    document.head.appendChild(label);
    label.click();
    document.head.removeChild(label);
  } catch {}
}

function fire(pattern: number[]): void {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    navigator.vibrate(pattern);
    return;
  }
  if (typeof window === "undefined" || !window.matchMedia("(pointer: coarse)").matches) return;
  let t = 0;
  pattern.forEach((ms, i) => {
    if (i % 2 === 0) {
      if (t === 0) switchClick();
      else setTimeout(switchClick, t);
    }
    t += ms;
  });
}

export function pulse(strength: PulseStrength): void {
  "worklet";
  if (gate.value) fire(PATTERNS[strength]);
}

export function tap(kind: TapHaptic, at?: number): void {
  const wait = at === undefined ? 0 : at - performance.now();
  const run = () => {
    if (gate.value) fire(PATTERNS[kind]);
  };
  if (wait < -LATE_MS) return;
  if (wait > 0) setTimeout(run, wait);
  else run();
}
