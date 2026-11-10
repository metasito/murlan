import { useMemo, useState } from "react";
import { useSharedValue, type FrameInfo, type SharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { inBackground, startOf, stampChange, useDuring } from "@/lib/motion";
import { contactMs, flightEndMs, type CardFrom, type CardSlot } from "@/components/flightPose";
import { LAND_WOBBLE_MS, type ImpactTier } from "@/components/impact";
import type { PulseStep } from "@/lib/device/feedback";

export interface FlightSpec {
  key: string; n: number; from: CardFrom[]; to: CardSlot[]; catchUp: boolean; reduced: boolean; native?: boolean;
  /** Computed on JS when the spec is built (`flightSpec`), never on the UI thread's first frame. */
  contact: number;
  end: number;
}
export interface LandingPayload { tier: ImpactTier; cards: number; x: number; y: number; goingOut: boolean; heavy: boolean; mine: boolean; catchUp: boolean; pulses: readonly PulseStep[] }
/** `key`: the play whose contact this is. */
export interface LandingSignal extends LandingPayload { key: string; seq: number; at: number }
export const NO_LANDING: LandingSignal = { key: "", seq: 0, at: 0, tier: "ordinary", cards: 0, x: 0, y: 0, goingOut: false, heavy: false, mine: false, catchUp: false, pulses: [] };

export function flightSpec(key: string, from: CardFrom[], to: CardSlot[], catchUp: boolean, reduced: boolean, native = false): FlightSpec {
  const n = to.length;
  return {
    key, n, from, to, catchUp, reduced, native,
    contact: reduced ? 0 : contactMs(n, from, to, catchUp, native),
    end: reduced ? 0 : flightEndMs(n, catchUp, native),
  };
}

export { inBackground };

interface Run { spec: FlightSpec | null; thrownAt: number; startedAt: number; touched: boolean }

export const AT_REST = Number.POSITIVE_INFINITY;

export interface FlightClock {
  elapsed: SharedValue<number>;
  arm(landing: LandingPayload): void;
  begin(spec: FlightSpec): void;
  /** Puts the cards at rest and stops the frames, with no landing and no report: the owner calls it once the flight has ended, or to withdraw it. */
  halt(): void;
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
    if (!r.spec) return false;
    if (r.startedAt < 0) {
      r.startedAt = startOf(frame.timestamp, r.thrownAt);
      scheduleOnRN(report.start, r.spec.key, r.startedAt + r.spec.contact, r.startedAt + r.spec.end);
    }
    const t = frame.timestamp - r.startedAt;
    elapsed.value = t;
    if (!r.touched && t >= r.spec.contact) {
      r.touched = true;
      const l = landing.value;
      if (l) signal.value = { ...l, key: r.spec.key, seq: signal.value.seq + 1, at: frame.timestamp };
      scheduleOnRN(report.touch, r.spec.key, frame.timestamp);
    }
    if (t >= r.spec.end + (r.spec.reduced ? 0 : LAND_WOBBLE_MS)) {
      const key = r.spec.key;
      r.spec = null;
      scheduleOnRN(report.end, key);
      return false;
    }
    return true;
  };
}

export function useFlightClock(
  signal: SharedValue<LandingSignal>,
  onStart: (key: string, landsAt: number, endsAt: number) => void,
  onContact: (key: string, at: number) => void,
  onEnd: (key: string) => void,
  /** Cards that will not fly start where they rest; ones about to fly start where they are thrown from. */
  resting = false
): FlightClock {
  const run = useSharedValue<Run>({ spec: null, thrownAt: 0, startedAt: -1, touched: false });
  const elapsed = useSharedValue(resting ? AT_REST : 0);
  const landing = useSharedValue<LandingPayload | null>(null);
  // The callbacks are the first render's: `PileLayer` hands in stable ones.
  const [step] = useState(() => stepper(run, elapsed, landing, signal, { start: onStart, touch: onContact, end: onEnd }));
  const wake = useDuring(step);
  return useMemo(
    () => ({
      elapsed,
      arm: (l: LandingPayload) => landing.set(l),
      begin: (spec: FlightSpec) => {
        run.set({ spec, thrownAt: stampChange(), startedAt: -1, touched: false });
        elapsed.set(0);
        wake();
      },
      halt: () => {
        run.set({ spec: null, thrownAt: 0, startedAt: -1, touched: true });
        elapsed.set(AT_REST);
      },
    }),
    [elapsed, landing, run, wake]
  );
}
