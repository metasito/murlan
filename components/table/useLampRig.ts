import { useCallback, useEffect, useMemo, useState } from "react";
import { useAnimatedReaction, useFrameCallback, useSharedValue, type FrameInfo, type SharedValue } from "react-native-reanimated";
import { usePrefersReducedMotion } from "@/lib/accessibility";
import { RoundMoment, Motion } from "@/lib/theme";
import { useTraceSource } from "@/lib/e2eTrace";
import { flareKindFor } from "@/components/impact";
import { designScale, lampControls, lampMoved, restingLamp, stepLamp, type Lamp, type LevelOwner, type Pool } from "./lampRig";
import { glossLightOf, nextGlossLight, type GlossLight } from "./cardGloss";
import { useLandingReaction } from "./useLandingReaction";
import { useBombBeat } from "./useBombBeat";
import type { LandingSignal } from "./useFlightClock";

/** The mockup's `deal` chapter: the lamp comes up from 75% as the cards fly. */
const BREATH_FROM = 0.75;
const BREATH_RATE = 2.2;

/** The controls keep their identities while the size changes, so an effect firing one can depend on them. */
export interface LampRig {
  lamp: SharedValue<Lamp>;
  /** The lamp in the coarser steps the card glosses follow (`cardGloss.ts`). */
  glossLight: SharedValue<GlossLight>;
  /** Design points to the felt box's own. */
  sx: number;
  sy: number;
  /** `owner`'s hold on the level, `null` to release it; the lamp sits at the lowest hold. */
  hold(owner: LevelOwner, level: number | null, rate: number): void;
  freeze(amount: number): void;
}

function lampStepper(lamp: SharedValue<Lamp>, glossLight: SharedValue<GlossLight>, reduced: SharedValue<boolean>) {
  return (frame: FrameInfo) => {
    "worklet";
    const s = lamp.value;
    stepLamp(s, (frame.timeSincePreviousFrame ?? 0) / 1000, reduced.value);
    if (lampMoved(s)) lamp.modify(undefined, true);
    const gloss = nextGlossLight(glossLight.value, s);
    if (gloss) glossLight.value = gloss;
  };
}

export function useLampRig({
  pool,
  deal,
  width,
  height,
  landing,
  dim = false,
}: {
  pool: Pool;
  /** Held at `RoundMoment.lostLevel` while true, back to 1 after. */
  dim?: boolean;
  /** A deal under way, `offsetMs` its onset on its clock: the lamp comes up a lead after it. */
  deal: { offsetMs: number; clock: SharedValue<number> } | undefined;
  width: number;
  height: number;
  /** A landing that flares (#765) flares the lamp, and a bomb's kicks it, on the contact frame. */
  landing: SharedValue<LandingSignal>;
}): LampRig {
  const reduceMotion = usePrefersReducedMotion();
  const reduced = useSharedValue(reduceMotion);
  const resting = restingLamp(pool, deal ? BREATH_FROM : 1);
  const lamp = useSharedValue<Lamp>(resting);
  const glossLight = useSharedValue<GlossLight>(glossLightOf(resting));
  const [px, py, reach] = pool;

  useEffect(() => {
    reduced.value = reduceMotion;
  }, [reduceMotion, reduced]);

  // The compiler drops a `useCallback` around a worklet, and `useFrameCallback` re-registers
  // on every new identity, stepping one frame with dt 0 each render.
  const [step] = useState(() => lampStepper(lamp, glossLight, reduced));
  useFrameCallback(step);

  useEffect(() => {
    lamp.modify((s) => {
      "worklet";
      lampControls.setTarget(s, [px, py, reach], reduced.value);
      return s;
    }, true);
  }, [px, py, reach, lamp, reduced]);

  useEffect(() => {
    lamp.modify((s) => {
      "worklet";
      if (dim) lampControls.hold(s, "lost", RoundMoment.lostLevel, RoundMoment.lostLevelRate);
      else lampControls.hold(s, "lost", null, RoundMoment.releaseRate);
      return s;
    }, true);
  }, [dim, lamp]);

  const dealClock = deal?.clock;
  const riseAt = (deal?.offsetMs ?? 0) + Motion.deal.lead;
  useEffect(() => {
    if (!dealClock) return;
    lamp.modify((s) => {
      "worklet";
      lampControls.hold(s, "breath", BREATH_FROM, BREATH_RATE);
      s.lvl = s.lvlT;
      return s;
    }, true);
    // A deal gone before its rise leaves the lamp where it would have risen to, at once.
    return () =>
      lamp.modify((s) => {
        "worklet";
        if (s.holds.breath === 1) return s;
        lampControls.hold(s, "breath", null, BREATH_RATE);
        s.lvl = s.lvlT;
        return s;
      }, true);
  }, [dealClock, lamp]);
  useAnimatedReaction(
    () => (dealClock ? dealClock.value : -1),
    (now, prev) => {
      if (now < riseAt || (prev !== null && prev >= riseAt)) return;
      lamp.modify((s) => {
        "worklet";
        lampControls.hold(s, "breath", null, BREATH_RATE);
        return s;
      }, true);
    }
  );

  useLandingReaction(landing, (l) => {
    "worklet";
    if (flareKindFor(l.tier) !== "settle" || reduced.value) return;
    lamp.modify((s) => {
      "worklet";
      lampControls.flare(s, false);
      return s;
    }, true);
  });
  useBombBeat(landing, reduceMotion, () => {
    "worklet";
    lamp.modify((s) => {
      "worklet";
      lampControls.flare(s, false);
      lampControls.kick(s, false);
      return s;
    }, true);
  });

  const { sx, sy } = designScale(width, height);
  useTraceSource(
    "lamp",
    useCallback(() => {
      const s = lamp.value;
      return { x: s.lx * sx, y: s.ly * sy, level: s.level, flare: s.f, r: s.r, ph: s.ph, freeze: s.freeze, kick: s.kick, clock: s.t };
    }, [lamp, sx, sy])
  );

  const controls = useMemo((): Pick<LampRig, "hold" | "freeze"> => {
    const control = (apply: (s: Lamp) => void) =>
      lamp.modify((s) => {
        "worklet";
        apply(s);
        return s;
      }, true);
    return {
      hold: (owner, level, rate) =>
        control((s) => {
          "worklet";
          lampControls.hold(s, owner, level, rate);
        }),
      freeze: (amount) =>
        control((s) => {
          "worklet";
          lampControls.freeze(s, amount);
        }),
    };
  }, [lamp]);

  return useMemo(() => ({ lamp, glossLight, sx, sy, ...controls }), [lamp, glossLight, sx, sy, controls]);
}
