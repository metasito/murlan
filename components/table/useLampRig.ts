import { useCallback, useEffect, useMemo, useState } from "react";
import { useAnimatedReaction, useFrameCallback, useSharedValue, type FrameInfo, type SharedValue } from "react-native-reanimated";
import { usePrefersReducedMotion } from "@/lib/accessibility";
import { Motion } from "@/lib/theme";
import { useTraceSource } from "@/lib/e2eTrace";
import { flareKindFor } from "@/components/flightPhysics";
import { designScale, lampControls, lampMoved, restingLamp, stepLamp, type Lamp, type Pool } from "./lampRig";
import { useLandingReaction } from "./useLandingReaction";
import type { LandingSignal } from "./useFlightClock";

/** The mockup's `deal` chapter: the lamp comes up from 75% as the cards fly. */
const BREATH_FROM = 0.75;
const BREATH_RATE = 2.2;

/** The controls keep their identities while the size changes, so an effect firing one can depend on them. */
export interface LampRig {
  lamp: SharedValue<Lamp>;
  /** Design points to the felt box's own. */
  sx: number;
  sy: number;
  flare(): void;
  kick(): void;
  setLevel(to: number, rate: number): void;
  freeze(amount: number): void;
}

function lampStepper(lamp: SharedValue<Lamp>, reduced: SharedValue<boolean>) {
  return (frame: FrameInfo) => {
    "worklet";
    const s = lamp.value;
    stepLamp(s, (frame.timeSincePreviousFrame ?? 0) / 1000, reduced.value);
    if (lampMoved(s)) lamp.modify(undefined, true);
  };
}

export function useLampRig({
  pool,
  deal,
  width,
  height,
  landing,
}: {
  pool: Pool;
  /** A deal under way, `offsetMs` its onset on its clock: the lamp comes up a lead after it. */
  deal: { offsetMs: number; clock: SharedValue<number> } | undefined;
  width: number;
  height: number;
  /** A landing that flares (#765) flares the lamp, and a bomb's kicks it, on the contact frame. */
  landing: SharedValue<LandingSignal>;
}): LampRig {
  const reduceMotion = usePrefersReducedMotion();
  const reduced = useSharedValue(reduceMotion);
  const lamp = useSharedValue<Lamp>(restingLamp(pool, deal ? BREATH_FROM : 1));
  const [px, py, reach] = pool;

  useEffect(() => {
    reduced.value = reduceMotion;
  }, [reduceMotion, reduced]);

  // The compiler drops a `useCallback` around a worklet, and `useFrameCallback` re-registers
  // on every new identity, stepping one frame with dt 0 each render.
  const [step] = useState(() => lampStepper(lamp, reduced));
  useFrameCallback(step);

  useEffect(() => {
    lamp.modify((s) => {
      "worklet";
      lampControls.setTarget(s, [px, py, reach], reduced.value);
      return s;
    }, true);
  }, [px, py, reach, lamp, reduced]);

  const dealClock = deal?.clock;
  const riseAt = (deal?.offsetMs ?? 0) + Motion.deal.lead;
  useEffect(() => {
    if (!dealClock) return;
    lamp.modify((s) => {
      "worklet";
      s.lvl = BREATH_FROM;
      lampControls.setLevel(s, BREATH_FROM, BREATH_RATE);
      return s;
    }, true);
    return () =>
      lamp.modify((s) => {
        "worklet";
        if (s.lvlT !== BREATH_FROM) return s;
        s.lvl = 1;
        lampControls.setLevel(s, 1, BREATH_RATE);
        return s;
      }, true);
  }, [dealClock, lamp]);
  useAnimatedReaction(
    () => (dealClock ? dealClock.value : -1),
    (now, prev) => {
      if (now < riseAt || (prev !== null && prev >= riseAt)) return;
      lamp.modify((s) => {
        "worklet";
        lampControls.setLevel(s, 1, BREATH_RATE);
        return s;
      }, true);
    }
  );

  useLandingReaction(landing, (l) => {
    "worklet";
    const kind = flareKindFor(l.tier);
    if (kind === "none" || reduced.value) return;
    lamp.modify((s) => {
      "worklet";
      lampControls.flare(s, false);
      if (kind === "brief") lampControls.kick(s, false);
      return s;
    }, true);
  });

  const { sx, sy } = designScale(width, height);
  useTraceSource(
    "lamp",
    useCallback(() => {
      const s = lamp.value;
      return { x: s.lx * sx, y: s.ly * sy, level: s.level, flare: s.f, r: s.r, ph: s.ph, freeze: s.freeze };
    }, [lamp, sx, sy])
  );

  const controls = useMemo((): Pick<LampRig, "flare" | "kick" | "setLevel" | "freeze"> => {
    const control = (apply: (s: Lamp, r: boolean) => void) => () =>
      lamp.modify((s) => {
        "worklet";
        apply(s, reduced.value);
        return s;
      }, true);
    return {
      flare: control((s, r) => {
        "worklet";
        lampControls.flare(s, r);
      }),
      kick: control((s, r) => {
        "worklet";
        lampControls.kick(s, r);
      }),
      setLevel: (to, rate) =>
        control((s) => {
          "worklet";
          lampControls.setLevel(s, to, rate);
        })(),
      freeze: (amount) =>
        control((s) => {
          "worklet";
          lampControls.freeze(s, amount);
        })(),
    };
  }, [lamp, reduced]);

  return useMemo(() => ({ lamp, sx, sy, ...controls }), [lamp, sx, sy, controls]);
}
