// End B of the settled felt, on web: a 2D canvas over the Skia felt, filled once from it, whose opacity a
// compositor animation carries along the lamp's sway. The Skia canvas keeps end A and draws nothing while
// the table rests (rule 51); docs/adr/0020-the-table-at-rest-plays-precomputed-tracks.md.
import { useLayoutEffect, useRef, useState } from "react";
import { StyleSheet } from "react-native";
import Animated, { useAnimatedReaction } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { usePrefersReducedMotion } from "@/lib/accessibility";
import { E2E_FAST } from "@/lib/e2eConfig";
import { afterFrames, ambientPlace, steerAmbient, useAmbient } from "@/lib/motion";
import type { EndsProps } from "./feltCanvas";
import { DRIFT_CHECK_MS, endTrack, isRested, placeOf, QUIET_MS, START_WAIT_FRAMES, steering, type EndTrack } from "./restEnds";

function copyOf(host: unknown, into: HTMLCanvasElement): boolean {
  const from = (host as HTMLElement | null)?.querySelector("canvas");
  if (!from || from.width === 0 || from.height === 0) return false;
  if (into.width !== from.width || into.height !== from.height) {
    into.width = from.width;
    into.height = from.height;
  }
  // The felt's drawing buffer is display-p3 (SkiaPictureView.web.js): a 2D canvas in sRGB would convert it.
  const context = into.getContext("2d", { colorSpace: "display-p3" }) ?? into.getContext("2d");
  if (!context) return false;
  context.drawImage(from, 0, 0);
  return true;
}

export function EndB({ lamp, settle, content, side, host, canvas: skia }: EndsProps) {
  const reduceMotion = usePrefersReducedMotion();
  const [steady, setSteady] = useState(false);
  const [quiet, setQuiet] = useState(false);
  const [playing, setPlaying] = useState<EndTrack | null>(null);
  const layer = useRef<HTMLCanvasElement>(null);
  const quietTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // In the frame the table stops being at rest: the overlay is stale from then, and a passive cleanup would leave it a frame over the live felt.
  const [hide] = useState(() => () => {
    if (layer.current) layer.current.style.visibility = "hidden";
    side.set(0);
  });

  useAnimatedReaction(
    () => isRested(lamp.value) && settle.value === 0,
    (now, before) => {
      if (now === before) return;
      if (!now) scheduleOnRN(hide);
      scheduleOnRN(setSteady, now);
    },
  );

  const [onContent] = useState(() => () => {
    hide();
    setQuiet(false);
    if (quietTimer.current) clearTimeout(quietTimer.current);
    quietTimer.current = setTimeout(() => setQuiet(true), QUIET_MS);
  });
  useAnimatedReaction(
    () => content.value,
    (now, before) => {
      if (before !== null && now !== before) scheduleOnRN(onContent);
    },
  );
  useLayoutEffect(() => {
    onContent();
    return () => {
      if (quietTimer.current) clearTimeout(quietTimer.current);
    };
  }, [onContent]);

  const engaged = steady && quiet && !reduceMotion;
  useLayoutEffect(() => {
    const canvas = layer.current;
    if (!engaged || !canvas) return;
    let live = true;
    let baked: EndTrack | null = null;
    const cancels: (() => void)[] = [];
    let check: ReturnType<typeof setInterval> | undefined;
    const steer = (to?: { paused: boolean }) => {
      const element = canvas.parentElement;
      if (!element || !baked) return;
      steerAmbient(element, to ?? { place: placeOf(baked, lamp.get().t) });
    };
    const bake = () => {
      const s = lamp.get();
      baked = endTrack(s.ph, s.t);
      setPlaying(baked);
      // The animation starts when the commit does, not when the track was read: it is moved to where the rig is, the frame it exists.
      cancels.push(afterFrames(2, () => whenPlaying(steer)));
    };
    // A table whose animation never starts shows no layer and draws live (rule 51 catches the cost), rather than waiting for it every frame.
    const giveUp = () => {
      clearInterval(check);
      setPlaying(null);
      hide();
    };
    const whenPlaying = (then: () => void) => {
      let waited = 0;
      const wait = () => {
        if (!live) return;
        if (!canvas.parentElement || ambientPlace(canvas.parentElement) !== null) return then();
        if (++waited > START_WAIT_FRAMES) return giveUp();
        cancels.push(afterFrames(1, wait));
      };
      wait();
    };
    bake();
    // The felt draws from a shared value through a mapper run and a redraw, each a microtask of its own, and an unpresented drawing buffer reads back blank: so end B is drawn now, by hand, before the copy, and end A drawn back by the redraw the write queues. Never presented.
    cancels.push(
      afterFrames(3, () => whenPlaying(() => {
        if (!live || !isRested(lamp.get())) return;
        steer();
        const mapperRun = (globalThis as { __mapperRun?: unknown }).__mapperRun;
        if (typeof mapperRun !== "function") return giveUp();
        side.set(1);
        mapperRun();
        skia.current?.makeImageSnapshot()?.dispose();
        if (copyOf(host.current, canvas)) {
          canvas.style.visibility = "visible";
          side.set(-1);
        } else side.set(0);
      })),
    );
    check = setInterval(() => {
      const element = canvas.parentElement;
      if (!element || !baked) return;
      const next = steering(baked, ambientPlace(element), lamp.get().t);
      if (next.kind === "rebake") bake();
      else if (next.kind === "steer") steerAmbient(element, { place: next.place });
    }, DRIFT_CHECK_MS);
    // A hidden page steps no rig while its animation keeps the clock: hold it, and put it where the rig is on return.
    const visibility = () => {
      if (document.hidden) steer({ paused: true });
      else {
        steer();
        steer({ paused: false });
      }
    };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      live = false;
      cancels.forEach((cancel) => cancel());
      clearInterval(check);
      document.removeEventListener("visibilitychange", visibility);
      hide();
      setPlaying(null);
    };
  }, [engaged, lamp, side, host, hide, skia]);

  const style = useAmbient(playing);
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, style]}>
      <canvas ref={layer} data-testid="felt-end-b" data-track-t={E2E_FAST ? playing?.t : undefined} style={{ visibility: "hidden", width: "100%", height: "100%" }} />
    </Animated.View>
  );
}
