// The table at rest (#1261): 40 motes lit only inside the lamp's cone, and a moth crossing the light, played by the compositor
// from tracks (moteTracks.ts) that are rebuilt when the lamp settles on a seat. Nothing here runs per frame; the burst
// canvas (particleLayer) is a separate layer that mounts only while something bursts.
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";
import Animated, { useAnimatedReaction } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
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
  bodyKeyframes,
  buildFlight,
  buildMoteTracks,
  coneKeyframes,
  driftKeyframes,
  flightAt,
  FLIGHT_S,
  litAt,
  REBUILD_S,
  SHADOW_BEAT,
  shadowKeyframes,
  SPAN_S,
  stillAlphas,
  TWINKLE_KEYFRAMES,
  TWINKLE_MS,
  twinkleDelay,
  WING_BEAT,
  type FlightStop,
  type MoteTrack,
  type MoteTracks,
  type RestLight,
} from "./moteTracks";

/** The lamp has glided to within 5% of a seat after three time constants; the tracks follow it there. */
const SETTLE_MS = (3 / GLIDE) * 1000;
const REBUILD_MS = REBUILD_S * 1000;
const MS = 1000;

const WING = { w: 14, h: 4 } as const;
const SHADOW = { w: 50, h: 12, rot: "0.3rad" } as const;

const styles = StyleSheet.create({
  fill: { position: "absolute", left: 0, top: 0, right: 0, bottom: 0 },
  anchor: { position: "absolute", left: 0, top: 0, width: 0, height: 0 },
  wings: { position: "absolute", left: -WING.w / 2, top: -WING.h / 2, width: WING.w, height: WING.h, flexDirection: "row" },
  wing: { width: WING.w / 2, height: WING.h, borderRadius: WING.h, backgroundColor: RestAir.moth },
  shadow: { position: "absolute", left: -SHADOW.w / 2, top: -SHADOW.h / 2, width: SHADOW.w, height: SHADOW.h, borderRadius: SHADOW.h, backgroundColor: RestAir.mothShadow, transform: [{ rotate: SHADOW.rot }] },
});

const dotOf = (r: number): ViewStyle => ({ position: "absolute", left: -r, top: -r, width: 2 * r, height: 2 * r, borderRadius: r, backgroundColor: RestAir.mote });

/** The air's own clock: seconds since mount, stopped while the lamp is frozen. */
function useAirClock(frozen: boolean) {
  const clock = useRef<{ run: number; acc: number; on: boolean } | null>(null);
  const elapsed = useCallback(() => {
    const c = (clock.current ??= { run: performance.now(), acc: 0, on: true });
    return c.acc + (c.on ? (performance.now() - c.run) / MS : 0);
  }, []);
  useEffect(() => {
    const c = (clock.current ??= { run: performance.now(), acc: 0, on: true });
    if (frozen === !c.on) return;
    if (frozen) c.acc = elapsed();
    else c.run = performance.now();
    c.on = !frozen;
  }, [frozen, elapsed]);
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

const Moth = memo(function Moth({ stops, paused }: { stops: FlightStop[]; paused: boolean }) {
  const body = useMemo(() => ambient({ keyframes: bodyKeyframes(stops), duration: FLIGHT_S * MS, iterations: 1, paused }), [stops, paused]);
  const shadow = useMemo(() => ambient({ keyframes: shadowKeyframes(stops), duration: FLIGHT_S * MS, iterations: 1, paused }), [stops, paused]);
  const wings = useMemo(() => ambient({ keyframes: WING_BEAT.keyframes, duration: WING_BEAT.ms }), []);
  const spread = useMemo(() => ambient({ keyframes: SHADOW_BEAT.keyframes, duration: SHADOW_BEAT.ms }), []);
  return (
    <>
      <Animated.View style={[styles.anchor, shadow]}>
        <Animated.View style={[styles.shadow, spread]} />
      </Animated.View>
      <Animated.View style={[styles.anchor, body]}>
        <Animated.View style={[styles.wings, wings]}>
          <View style={styles.wing} />
          <View style={styles.wing} />
        </Animated.View>
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
  const [flight, setFlight] = useState<FlightStop[] | null>(null);
  const flightAt0 = useRef(0);
  const settle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const lightNow = useCallback((): RestLight => {
    const s = lamp.get();
    return { x: s.tx, ly: s.ty - LIGHT_ABOVE, level: s.lvlT, r: s.tr, tt: swayTimeOf(s.ph) };
  }, [lamp]);

  const rebuild = useCallback(() => {
    const light = lightNow();
    if (reduced) {
      setTracks(null);
      setStill(stillAlphas(air, light));
      return;
    }
    advanceAir(air, elapsed() - air.t);
    setStill(null);
    setTracks(buildMoteTracks(air, light));
  }, [air, elapsed, lightNow, reduced]);

  useEffect(() => {
    if (frozen) return;
    const first = setTimeout(rebuild, 0);
    const again = setInterval(rebuild, REBUILD_MS);
    return () => {
      clearTimeout(first);
      clearInterval(again);
    };
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
    if (reduced || frozen) return;
    const rng = tableRng();
    const gap = () => 10 + rng() * 5;
    let timer: ReturnType<typeof setTimeout>;
    const land = () => {
      setFlight(null);
      timer = setTimeout(fly, (gap() - FLIGHT_S) * MS);
    };
    const fly = () => {
      const l = lightNow();
      setFlight(buildFlight({ x: l.x, ly: l.ly, tt: l.tt }));
      flightAt0.current = elapsed();
      traceOnset("moment", "moth");
      timer = setTimeout(land, FLIGHT_S * MS);
    };
    timer = setTimeout(fly, Math.max(0, air.mothAt - elapsed()) * MS);
    return () => {
      clearTimeout(timer);
      setFlight(null);
    };
  }, [reduced, frozen, air, elapsed, lightNow]);

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
      if (!flight) return null;
      const p = flightAt(flight, Math.min(FLIGHT_S, elapsed() - flightAt0.current));
      return { x: p.mx * sx, y: p.my * sy };
    }, [flight, elapsed, sx, sy])
  );

  const sized = useMemo<ViewStyle>(
    () => ({ position: "absolute", left: 0, top: 0, width: DESIGN.width, height: DESIGN.height, transformOrigin: "top left", transform: [{ scaleX: sx }, { scaleY: sy }] }),
    [sx, sy]
  );
  return (
    <View testID="air" style={styles.fill} pointerEvents="none">
      <View style={sized}>
        {tracks?.motes.map((m) => <Mote key={`${tracks.built}-${m.i}`} track={m} built={tracks.built} paused={frozen} />)}
        {still?.map((a, i) => (a >= UNSEEN * MOTE_ALPHA ? <Still key={i} x={air.m[i * MOTE_STRIDE + M.x]} y={air.m[i * MOTE_STRIDE + M.y]} r={air.m[i * MOTE_STRIDE + M.r]} alpha={a} /> : null))}
        {flight && <Moth stops={flight} paused={frozen} />}
      </View>
    </View>
  );
}
