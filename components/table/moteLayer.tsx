// The table at rest (#1261): 40 motes lit only inside the lamp's cone, and a moth crossing the light, played by the compositor
// from tracks (moteTracks.ts) that are rebuilt when the lamp settles on a seat. Nothing here runs per frame; the burst
// canvas (particleLayer) is a separate layer that mounts only while something bursts.
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";
import Animated, { useAnimatedReaction } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { E2E_FAST } from "@/lib/e2eConfig";
import { traceOnset, useTraceSource } from "@/lib/e2eTrace";
import { usePrefersReducedMotion } from "@/lib/accessibility";
import { ambient } from "@/lib/motion";
import { swayTimeOf } from "@/lib/swayTable";
import { RestAir } from "@/lib/tokens";
import { createAir, M, MOTE_ALPHA, MOTE_STRIDE, MOTES, UNSEEN, type Air } from "./air";
import { DESIGN, GLIDE, LIGHT_ABOVE } from "./lampRig";
import type { LampRig } from "./useLampRig";
import { tableRng } from "./particles";
import {
  advanceAir,
  buildMoteTracks,
  buildMoth,
  coneKeyframes,
  driftKeyframes,
  litAt,
  mothAt,
  mothKeyframes,
  SHADOW_MEAN,
  SPAN_S,
  stillAlphas,
  TWINKLE_KEYFRAMES,
  TWINKLE_MS,
  twinkleDelay,
  WING_MEAN,
  type Flight,
  type MoteTrack,
  type MoteTracks,
  type RestLight,
} from "./moteTracks";

/** The lamp has glided to within 5% of a seat after three time constants; the tracks follow it there. */
const SETTLE_MS = (3 / GLIDE) * 1000;
const MS = 1000;

const WING = { w: 2 * WING_MEAN, h: 4 } as const;
const SHADOW = { w: 2 * SHADOW_MEAN, h: 12, rot: "0.3rad" } as const;

const styles = StyleSheet.create({
  airBox: { position: "absolute", left: 0, top: 0, right: 0, bottom: 0 },
  anchor: { position: "absolute", left: 0, top: 0, width: 0, height: 0 },
  wings: { position: "absolute", left: -WING.w / 2, top: -WING.h / 2, width: WING.w, height: WING.h, flexDirection: "row" },
  wing: { width: WING.w / 2, height: WING.h, borderRadius: WING.h, backgroundColor: RestAir.moth },
  shadow: { position: "absolute", left: -SHADOW.w / 2, top: -SHADOW.h / 2, width: SHADOW.w, height: SHADOW.h, borderRadius: SHADOW.h, backgroundColor: RestAir.mothShadow, transform: [{ rotate: SHADOW.rot }] },
});

const dotOf = (r: number): ViewStyle => ({ position: "absolute", left: -r, top: -r, width: 2 * r, height: 2 * r, borderRadius: r, backgroundColor: RestAir.mote });

/** The air's own clock: seconds since mount, stopped while the lamp is frozen. */
function useAirClock(frozen: boolean) {
  const clock = useRef({ run: -1, acc: 0, on: true });
  const started = useCallback(() => {
    const c = clock.current;
    if (c.run < 0) c.run = performance.now();
    return c;
  }, []);
  const elapsed = useCallback(() => {
    const c = started();
    return c.acc + (c.on ? (performance.now() - c.run) / MS : 0);
  }, [started]);
  useEffect(() => {
    const c = started();
    if (frozen === !c.on) return;
    if (frozen) c.acc = elapsed();
    else c.run = performance.now();
    c.on = !frozen;
  }, [frozen, elapsed, started]);
  return elapsed;
}

const Mote = memo(function Mote({ track, built, paused }: { track: MoteTrack; built: number; paused: boolean }) {
  const drift = useMemo(() => ambient({ keyframes: driftKeyframes(track), duration: SPAN_S * MS, paused }), [track, paused]);
  const cone = useMemo(() => ambient({ keyframes: coneKeyframes(track), duration: SPAN_S * MS, paused }), [track, paused]);
  const twinkle = useMemo(
    () => ambient({ keyframes: TWINKLE_KEYFRAMES, duration: TWINKLE_MS, delay: twinkleDelay(track.ph) - built * MS, paused }),
    [track.ph, built, paused]
  );
  const dot = useMemo(() => dotOf(track.r), [track.r]);
  return (
    <Animated.View style={[styles.anchor, drift]}>
      <Animated.View style={[styles.anchor, twinkle]}>
        <Animated.View style={[dot, { opacity: track.cone[0].v }, cone]} />
      </Animated.View>
    </Animated.View>
  );
});

const Still = memo(function Still({ x, y, r, alpha }: { x: number; y: number; r: number; alpha: number }) {
  return (
    <View style={[styles.anchor, { transform: [{ translateX: x }, { translateY: y }] }]}>
      <View style={[dotOf(r), { opacity: alpha }]} />
    </View>
  );
});

const Moth = memo(function Moth({ flights, paused }: { flights: Flight[]; paused: boolean }) {
  const body = useMemo(() => ambient({ keyframes: mothKeyframes(flights, "body"), duration: SPAN_S * MS, paused }), [flights, paused]);
  const shadow = useMemo(() => ambient({ keyframes: mothKeyframes(flights, "shadow"), duration: SPAN_S * MS, paused }), [flights, paused]);
  return (
    <>
      <Animated.View style={[styles.anchor, { opacity: 0 }, shadow]}>
        <View style={styles.shadow} />
      </Animated.View>
      <Animated.View style={[styles.anchor, { opacity: 0 }, body]}>
        <View style={styles.wings}>
          <View style={styles.wing} />
          <View style={styles.wing} />
        </View>
      </Animated.View>
    </>
  );
});

export function MoteLayer({ rig }: { rig: Pick<LampRig, "lamp" | "stillLight" | "sx" | "sy"> }) {
  const { lamp, stillLight, sx, sy } = rig;
  const reduced = usePrefersReducedMotion();
  const [frozen, setFrozen] = useState(false);
  const elapsed = useAirClock(frozen);
  const [air] = useState<Air>(() => createAir(tableRng()));
  const [tracks, setTracks] = useState<MoteTracks | null>(null);
  const [still, setStill] = useState<number[] | null>(null);
  const [moth, setMoth] = useState<Flight[] | null>(null);
  const [rng] = useState(tableRng);
  const nextMoth = useRef(air.mothAt);
  const settle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const lightNow = useCallback((): RestLight => {
    const s = lamp.get();
    return { x: s.tx, ly: s.ty - LIGHT_ABOVE, level: s.lvlT, r: s.tr, tt: swayTimeOf(s.ph) };
  }, [lamp]);

  const rebuild = useCallback(() => {
    const light = lightNow();
    if (reduced) {
      setTracks(null);
      setMoth(null);
      setStill(stillAlphas(air, light));
      return;
    }
    advanceAir(air, elapsed() - air.t);
    const { flights } = buildMoth(light, air.t, nextMoth.current, rng);
    nextMoth.current = air.t + flights[0].s;
    setStill(null);
    setMoth(flights);
    setTracks(buildMoteTracks(air, light));
  }, [air, elapsed, lightNow, reduced, rng]);

  useEffect(() => {
    if (frozen) return;
    const first = setTimeout(rebuild, 0);
    return () => clearTimeout(first);
  }, [rebuild, frozen]);

  const onMoved = useCallback(() => {
    clearTimeout(settle.current);
    settle.current = setTimeout(rebuild, SETTLE_MS);
  }, [rebuild]);
  useEffect(() => () => clearTimeout(settle.current), []);
  useAnimatedReaction(
    () => stillLight.value,
    (now, before) => {
      if (before !== null && now !== before) scheduleOnRN(onMoved);
    }
  );
  useAnimatedReaction(
    () => lamp.value.freeze >= 1,
    (now, before) => {
      if (now !== before) scheduleOnRN(setFrozen, now);
    }
  );

  useEffect(() => {
    if (!E2E_FAST || !tracks || !moth || frozen) return;
    const timers = moth.map((f) => setTimeout(() => traceOnset("moment", "moth"), (tracks.built + f.s - elapsed()) * MS));
    return () => timers.forEach(clearTimeout);
  }, [tracks, moth, frozen, elapsed]);

  useTraceSource("live", useCallback(() => MOTES, []));
  useTraceSource(
    "motes",
    useCallback(() => {
      if (tracks) return litAt(tracks, Math.min(SPAN_S, elapsed() - tracks.built));
      return still ? still.filter((a) => a >= UNSEEN * MOTE_ALPHA).length : 0;
    }, [tracks, still, elapsed])
  );
  useTraceSource(
    "moth",
    useCallback(() => {
      if (!tracks || !moth) return null;
      const p = mothAt(moth, elapsed() - tracks.built);
      return p && { x: p.mx * sx, y: p.my * sy };
    }, [tracks, moth, elapsed, sx, sy])
  );

  const sized = useMemo<ViewStyle>(
    () => ({ position: "absolute", left: 0, top: 0, width: DESIGN.width, height: DESIGN.height, transformOrigin: "top left", transform: [{ scaleX: sx }, { scaleY: sy }] }),
    [sx, sy]
  );
  return (
    <View testID="air" style={styles.airBox} pointerEvents="none">
      <View style={sized}>
        {tracks?.motes.map((m) => <Mote key={`${tracks.built}-${m.i}`} track={m} built={tracks.built} paused={frozen} />)}
        {still?.map((a, i) => (a >= UNSEEN * MOTE_ALPHA ? <Still key={i} x={air.m[i * MOTE_STRIDE + M.x]} y={air.m[i * MOTE_STRIDE + M.y]} r={air.m[i * MOTE_STRIDE + M.r]} alpha={a} /> : null))}
        {tracks && moth && <Moth key={tracks.built} flights={moth} paused={frozen} />}
      </View>
    </View>
  );
}
