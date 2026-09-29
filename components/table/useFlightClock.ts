import { useMemo, useState } from "react";
import { AppState } from "react-native";
import { useFrameCallback, useSharedValue, type FrameInfo, type SharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { contactMs, flightEndMs, type CardFrom, type CardSlot } from "@/components/flightPose";
import { LAND_WOBBLE_MS, type ImpactTier } from "@/components/flightPhysics";
import type { PulseStep } from "@/lib/device/feedback";

export interface FlightSpec {
  key: string; n: number; from: CardFrom[]; to: CardSlot[]; catchUp: boolean; reduced: boolean;
  /** Computed on JS when the spec is built (`flightSpec`), never on the UI thread's first frame. */
  contact: number;
  end: number;
}
export interface LandingPayload { tier: ImpactTier; cards: number; x: number; y: number; flush: boolean; heavy: boolean; mine: boolean; pulses: readonly PulseStep[] }
export interface LandingSignal extends LandingPayload { seq: number; at: number }
export const NO_LANDING: LandingSignal = { seq: 0, at: 0, tier: "ordinary", cards: 0, x: 0, y: 0, flush: false, heavy: false, mine: false, pulses: [] };

export function flightSpec(key: string, from: CardFrom[], to: CardSlot[], catchUp: boolean, reduced: boolean): FlightSpec {
  const n = to.length;
  return {
    key, n, from, to, catchUp, reduced,
    contact: reduced ? 0 : contactMs(n, from, to, catchUp),
    end: reduced ? 0 : flightEndMs(n, catchUp),
  };
}

/** No frames are drawn: a hidden page (react-native-web maps visibility here) or a backgrounded app. */
export const inBackground = () => AppState.currentState === "background";

interface Run { spec: FlightSpec | null; thrownAt: number; startedAt: number; touched: boolean }

export interface FlightClock {
  elapsed: SharedValue<number>;
  arm(landing: LandingPayload): void;
  begin(spec: FlightSpec): void;
}

function stepper(
  run: SharedValue<Run>,
  elapsed: SharedValue<number>,
  landing: SharedValue<LandingPayload | null>,
  signal: SharedValue<LandingSignal>,
  report: { start: (k: string, at: number, end: number) => void; touch: (k: string, at: number) => void; end: (k: string) => void }
) {
  return (frame: FrameInfo) => {
    "worklet";
    const r = run.value;
    if (!r.spec) return;
    if (r.startedAt < 0) {
      // On the throw's clock, not the first frame's: web hands a new frame callback its first frame two frames late.
      r.startedAt = Math.min(frame.timestamp, r.thrownAt);
      scheduleOnRN(report.start, r.spec.key, r.startedAt + r.spec.contact, r.startedAt + r.spec.end);
    }
    const t = frame.timestamp - r.startedAt;
    elapsed.value = t;
    if (!r.touched && t >= r.spec.contact) {
      r.touched = true;
      const l = landing.value;
      if (l) signal.value = { ...l, seq: signal.value.seq + 1, at: frame.timestamp };
      scheduleOnRN(report.touch, r.spec.key, frame.timestamp);
    }
    if (t >= r.spec.end + (r.spec.reduced ? 0 : LAND_WOBBLE_MS)) {
      const key = r.spec.key;
      r.spec = null;
      scheduleOnRN(report.end, key);
    }
  };
}

export function useFlightClock(
  signal: SharedValue<LandingSignal>,
  onStart: (key: string, landsAt: number, endsAt: number) => void,
  onContact: (key: string, at: number) => void,
  onEnd: (key: string) => void
): FlightClock {
  const run = useSharedValue<Run>({ spec: null, thrownAt: 0, startedAt: -1, touched: false });
  const elapsed = useSharedValue(0);
  const landing = useSharedValue<LandingPayload | null>(null);
  // The callbacks are the first render's: `FlyingCards` hands in stable ones. The frame callback
  // stays registered, idle, until the flight unmounts.
  const [step] = useState(() => stepper(run, elapsed, landing, signal, { start: onStart, touch: onContact, end: onEnd }));
  const frames = useFrameCallback(step, false);
  return useMemo(
    () => ({
      elapsed,
      arm: (l: LandingPayload) => landing.set(l),
      begin: (spec: FlightSpec) => {
        run.set({ spec, thrownAt: inBackground() ? Infinity : performance.now(), startedAt: -1, touched: false });
        frames.setActive(true);
      },
    }),
    [elapsed, landing, run, frames]
  );
}
