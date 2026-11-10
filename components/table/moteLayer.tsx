// The table at rest (#1261): 40 motes lit only inside the lamp's cone, and a moth crossing the light, played by the compositor
// from tracks (moteTracks.ts) that are rebuilt when the lamp settles on a seat, and before they end. Nothing here runs per frame;
// the burst canvas (particleLayer) is a separate layer, mounted and idle until something bursts.
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";
import Animated, { useAnimatedReaction } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { E2E_FAST } from "@/lib/e2eConfig";
import { traceOnset, useTraceSource } from "@/lib/e2eTrace";
import { usePrefersReducedMotion } from "@/lib/accessibility";
import { ambient } from "@/lib/motion";
import { RestAir } from "@/lib/tokens";
import { createAir, isDrawn, M, MOTE_STRIDE, type Air } from "./air";
import { DESIGN, LIGHT_ABOVE } from "./lampRig";
import { LAMP_SETTLE_MS, type LampRig } from "./useLampRig";
import { tableRng } from "./particles";
import {
  rebuildTracks,
  litAt,
  mothAt,
  moteKeyframes,
  mothKeyframes,
  REBUILD_LEAD_S,
  SPAN_S,
  stillAlphas,
  trackAlpha,
  SHADOW_RX_MAX,
  WING_HALF_MAX,
  type Flight,
  type MoteTrack,
  type MoteTracks,
  type RestLight,
} from "./moteTracks";

const MS = 1000;

const WING = { w: 4 * WING_HALF_MAX, h: 4 } as const;
const SHADOW = { w: 2 * SHADOW_RX_MAX, h: 12, rot: "0.3rad" } as const;

const styles = StyleSheet.create({
  airBox: { position: "absolute", left: 0, top: 0, right: 0, bottom: 0 },
  anchor: { position: "absolute", left: 0, top: 0, width: 0, height: 0 },
  wings: { position: "absolute", left: -WING.w / 2, top: -WING.h / 2, width: WING.w, height: WING.h, flexDirection: "row" },
  wing: { width: WING.w / 2, height: WING.h, borderRadius: WING.h, backgroundColor: RestAir.moth },
  shadow: { position: "absolute", left: -SHADOW.w / 2, top: -SHADOW.h / 2, width: SHADOW.w, height: SHADOW.h, borderRadius: SHADOW.h, backgroundColor: RestAir.mothShadow, transform: [{ rotate: SHADOW.rot }] },
});

/** The mote's own box, at the origin: the animation moves it, and a zero-size box would not be composited. */
const boxOf = (r: number): ViewStyle => ({ position: "absolute", left: 0, top: 0, width: 2 * r, height: 2 * r, borderRadius: r, backgroundColor: RestAir.mote });

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

const Mote = memo(function Mote({ tracks, track, paused }: { tracks: MoteTracks; track: MoteTrack; paused: boolean }) {
  const motion = useMemo(() => ambient({ keyframes: moteKeyframes(tracks, track), duration: SPAN_S * MS, iterations: 1, holdEnd: true, paused }), [tracks, track, paused]);
  const box = useMemo(() => boxOf(track.r), [track.r]);
  return <Animated.View testID="air-mote" style={[box, { opacity: trackAlpha(tracks, track, 0) }, motion]} />;
});

const Still = memo(function Still({ x, y, r, alpha }: { x: number; y: number; r: number; alpha: number }) {
  return (
    <View style={[styles.anchor, { transform: [{ translateX: x }, { translateY: y }] }]}>
      <View testID="air-mote" style={[dotOf(r), { opacity: alpha }]} />
    </View>
  );
});

const Moth = memo(function Moth({ flights, paused }: { flights: Flight[]; paused: boolean }) {
  const body = useMemo(() => ambient({ keyframes: mothKeyframes(flights, "body"), duration: SPAN_S * MS, iterations: 1, holdEnd: true, paused }), [flights, paused]);
  const shadow = useMemo(() => ambient({ keyframes: mothKeyframes(flights, "shadow"), duration: SPAN_S * MS, iterations: 1, holdEnd: true, paused }), [flights, paused]);
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

export function MoteLayer({ rig }: { rig: Pick<LampRig, "lamp" | "sx" | "sy"> & Partial<Pick<LampRig, "stillLight">> }) {
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
    return { x: s.tx, ly: s.ty - LIGHT_ABOVE, level: s.lvlT, r: s.tr, ph: s.ph, t: s.t };
  }, [lamp]);

  const rebuild = useCallback(() => {
    const light = lightNow();
    if (reduced) {
      setTracks(null);
      setMoth(null);
      setStill(stillAlphas(air, light));
      return;
    }
    const next = rebuildTracks(air, light, elapsed(), nextMoth.current, rng);
    nextMoth.current = next.nextMoth;
    setStill(null);
    setMoth(next.flights);
    setTracks(next.tracks);
  }, [air, elapsed, lightNow, reduced, rng]);

  // Not on a thaw: the tracks and the air's clock were paused together, and a rebuild is the one long task the air has.
  useEffect(() => {
    const first = setTimeout(rebuild, 0);
    return () => clearTimeout(first);
  }, [rebuild]);

  useEffect(() => {
    if (!tracks || frozen) return;
    const left = tracks.built + SPAN_S - REBUILD_LEAD_S - elapsed();
    const next = setTimeout(rebuild, Math.max(0, left) * MS);
    return () => clearTimeout(next);
  }, [tracks, frozen, elapsed, rebuild]);

  const onMoved = useCallback(() => {
    clearTimeout(settle.current);
    settle.current = setTimeout(rebuild, LAMP_SETTLE_MS);
  }, [rebuild]);
  useEffect(() => () => clearTimeout(settle.current), []);
  useAnimatedReaction(
    () => stillLight?.value ?? null,
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

  useTraceSource(
    "motes",
    useCallback(() => {
      if (tracks) return litAt(tracks, Math.min(SPAN_S, elapsed() - tracks.built));
      return still ? still.filter(isDrawn).length : 0;
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
        {tracks?.motes.map((m) => <Mote key={`${tracks.built}-${m.i}`} tracks={tracks} track={m} paused={frozen} />)}
        {still?.map((a, i) => (isDrawn(a) ? <Still key={i} x={air.m[i * MOTE_STRIDE + M.x]} y={air.m[i * MOTE_STRIDE + M.y]} r={air.m[i * MOTE_STRIDE + M.r]} alpha={a} /> : null))}
        {tracks && moth && <Moth key={tracks.built} flights={moth} paused={frozen} />}
      </View>
    </View>
  );
}
