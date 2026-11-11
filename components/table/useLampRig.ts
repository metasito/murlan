import { useCallback, useEffect, useMemo, useState } from "react";
import { useAnimatedReaction, useSharedValue, type FrameInfo, type SharedValue } from "react-native-reanimated";
import { usePrefersReducedMotion } from "@/lib/accessibility";
import { RoundMoment, Motion } from "@/lib/theme";
import { useTraceSource } from "@/lib/e2eTrace";
import { useDuring } from "@/lib/motion";
import { Platform } from "react-native";
import { flareKindFor } from "@/components/impact";
import { createLampHold, designScale, GLIDE, lampControls, lampMoved, lampSettled, restingLamp, stepLamp, steppedLamp, type Lamp, type LampHold, type LampNow, type LevelOwner, type Pool } from "./lampRig";
import { createGlossTracks, type GlossTracks } from "./glossTrackStore";
import { endsCarry, isRested, restLight } from "./restEnds";
import { glossLightOf, nextGlossLight, nextShadeLevel, nextStillLight, type GlossLight } from "./cardGloss";
import { useLandingReaction } from "./useLandingReaction";
import { useBombBeat } from "./useBombBeat";
import type { LandingSignal } from "./useFlightClock";

/** The mockup's `deal` chapter: the lamp comes up from 75% as the cards fly. */
const BREATH_FROM = 0.75;
const BREATH_RATE = 2.2;

/** How long after its target moves the lamp has glided to within 5% of it: three of the glide's time constants. */
export const LAMP_SETTLE_MS = (3 / GLIDE) * 1000;

/** The controls keep their identities while the size changes, so an effect firing one can depend on them. */
export interface LampRig extends LampNow {
  /** The rig's own lamp, which it may have stopped stepping: what a frame draws is `now()`. A reaction reads it to run when the rig writes. */
  lamp: SharedValue<Lamp>;
  /** The lamp in the coarser steps the card glosses follow (`cardGloss.ts`). */
  glossLight: SharedValue<GlossLight>;
  /** The same light without the sway: where the lamp points, written when its target or level moves (`nextStillLight`). */
  stillLight: SharedValue<GlossLight>;
  /** Web only: the track the fans' gloss plays, baked where the lamp rests (`FanGloss`). Native draws every back live. */
  tracks?: GlossTracks;
  /** The lamp's level alone, in the steps the card shades follow: written when the level moves, never for the sway (`nextShadeLevel`). */
  shadeLevel: SharedValue<number>;
  /** Design points to the felt box's own. */
  sx: number;
  sy: number;
  /** `owner`'s hold on the level, `null` to release it; the lamp sits at the lowest hold. */
  hold(owner: LevelOwner, level: number | null, rate: number): void;
  freeze(amount: number): void;
}

function lampStepper(lamp: SharedValue<Lamp>, glossLight: SharedValue<GlossLight>, stillLight: SharedValue<GlossLight>, shadeLevel: SharedValue<number>, reduced: SharedValue<boolean>, tracks: GlossTracks | undefined, hold: LampHold | undefined) {
  return (frame: FrameInfo): boolean => {
    "worklet";
    const s = lamp.value;
    if (hold?.held()) hold.resume(s);
    else stepLamp(s, (frame.timeSincePreviousFrame ?? 0) / 1000, reduced.value);
    if (lampMoved(s)) lamp.modify(undefined, true);
    const gloss = nextGlossLight(glossLight.value, s);
    if (gloss) glossLight.value = gloss;
    const still = nextStillLight(stillLight.value, s);
    if (still) stillLight.value = still;
    // Called as the page, not scheduled onto it: on web a worklet runs on the JS thread, and `tracks` and `hold` are undefined on native, which never gets here.
    if (tracks) {
      const rested = isRested(s);
      if (rested === tracks.live()) tracks.update(rested);
    }
    const level = nextShadeLevel(shadeLevel.value, s);
    if (level !== null) shadeLevel.value = level;
    if (hold && tracks && endsCarry(s, tracks.ends.value, reduced.value)) {
      hold.hold();
      return false;
    }
    return !lampSettled(s, reduced.value);
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
  const stillLight = useSharedValue<GlossLight>(glossLightOf(resting));
  const shadeLevel = useSharedValue(resting.level);
  const [px, py, reach] = pool;
  const rest = useSharedValue<GlossLight>(restLight(resting));
  const ends = useSharedValue(0);
  const [hold] = useState(() => (Platform.OS === "web" ? createLampHold(lamp, reduced) : undefined));
  const [reader] = useState(() => hold ?? steppedLamp(lamp));
  const [tracks] = useState(() => (Platform.OS === "web" ? createGlossTracks(reader, rest, ends, resting) : undefined));

  // The compiler drops a `useCallback` around a worklet, and `useFrameCallback` re-registers
  // on every new identity, stepping one frame with dt 0 each render.
  const [step] = useState(() => lampStepper(lamp, glossLight, stillLight, shadeLevel, reduced, tracks, hold));
  const wake = useDuring(step, true);
  const [control] = useState(() => (apply: (s: Lamp) => void) => {
    "worklet";
    lamp.modify((s) => {
      "worklet";
      hold?.resume(s);
      apply(s);
      return s;
    }, true);
    wake();
  });
  const [resumeRig] = useState(() => () => {
    "worklet";
    if (hold?.held())
      lamp.modify((s) => {
        "worklet";
        hold.resume(s);
        return s;
      }, true);
    wake();
  });

  useEffect(() => {
    resumeRig();
    reduced.set(reduceMotion);
  }, [reduceMotion, reduced, resumeRig]);

  useEffect(() => {
    if (!hold) return;
    const shown = () => hold.shown(!document.hidden);
    shown();
    document.addEventListener("visibilitychange", shown);
    return () => document.removeEventListener("visibilitychange", shown);
  }, [hold]);

  useEffect(() => {
    control((s) => {
      "worklet";
      lampControls.setTarget(s, [px, py, reach], reduced.value);
    });
  }, [px, py, reach, reduced, control]);

  useEffect(() => {
    control((s) => {
      "worklet";
      if (dim) lampControls.hold(s, "lost", RoundMoment.lostLevel, RoundMoment.lostLevelRate);
      else lampControls.hold(s, "lost", null, RoundMoment.releaseRate);
    });
  }, [dim, control]);

  const dealClock = deal?.clock;
  const riseAt = (deal?.offsetMs ?? 0) + Motion.deal.lead;
  useEffect(() => {
    if (!dealClock) return;
    control((s) => {
      "worklet";
      lampControls.hold(s, "breath", BREATH_FROM, BREATH_RATE);
      s.lvl = s.lvlT;
    });
    // A deal gone before its rise leaves the lamp where it would have risen to, at once.
    return () => {
      control((s) => {
        "worklet";
        if (s.holds.breath === 1) return;
        lampControls.hold(s, "breath", null, BREATH_RATE);
        s.lvl = s.lvlT;
      });
    };
  }, [dealClock, control]);
  useAnimatedReaction(
    () => (dealClock ? dealClock.value : -1),
    (now, prev) => {
      if (now < riseAt || (prev !== null && prev >= riseAt)) return;
      control((s) => {
        "worklet";
        lampControls.hold(s, "breath", null, BREATH_RATE);
      });
    }
  );

  useAnimatedReaction(
    () => ends.value,
    (now, before) => {
      if (now !== 0 || before === null || before === 0) return;
      resumeRig();
    }
  );

  useLandingReaction(landing, (l) => {
    "worklet";
    if (flareKindFor(l.tier) !== "settle" || reduced.value) return;
    control((s) => {
      "worklet";
      lampControls.flare(s, false);
    });
  });
  useBombBeat(landing, reduceMotion, () => {
    "worklet";
    control((s) => {
      "worklet";
      lampControls.flare(s, false);
      lampControls.kick(s, false);
    });
  });

  const { sx, sy } = designScale(width, height);
  // `rig`, `held`, `ends` and `rested` are the rig's own, not the drawn lamp's: a rig that neither steps nor may hold is a stuck rig, which the specs must see.
  useTraceSource(
    "lamp",
    useCallback(() => {
      const own = lamp.value;
      const s = reader.now();
      return {
        x: s.lx * sx,
        y: s.ly * sy,
        level: s.level,
        flare: s.f,
        r: s.r,
        ph: s.ph,
        freeze: s.freeze,
        kick: s.kick,
        clock: s.t,
        rig: own.t,
        held: hold?.held() ?? false,
        ends: tracks?.ends.value ?? 0,
        rested: isRested(own),
      };
    }, [lamp, reader, hold, tracks, sx, sy])
  );

  const controls = useMemo((): Pick<LampRig, "hold" | "freeze"> => {
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
  }, [control]);

  return useMemo(() => ({ lamp, now: reader.now, clock: reader.clock, glossLight, stillLight, tracks, shadeLevel, sx, sy, ...controls }), [lamp, reader, glossLight, stillLight, tracks, shadeLevel, sx, sy, controls]);
}
