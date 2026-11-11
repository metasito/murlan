// The web's particle layer: the rest air (moteLayer) and a 2D canvas that stays mounted and draws only while a burst flies, whether or not
// CanvasKit has loaded — the felt swaps renderers, this never does (#1252).
import { lazy, Suspense, useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import type { FrameInfo, SharedValue } from "react-native-reanimated";
import { traceOnset, useTraceSource } from "@/lib/e2eTrace";
import { usePrefersReducedMotion } from "@/lib/accessibility";
import { useDuring } from "@/lib/motion";
import { MOTES } from "./air";
import { DESIGN, lampNow } from "./lampRig";
import type { LampRig } from "./useLampRig";
import { bombFx, landingDust, spawn, tableRng, type ParticleEmitter } from "./particles";
import { burstIdle, createBurstScene, stepBurst, type BurstScene } from "./burstScene";
import { startEmber } from "./ember";
import { startRain } from "./coneRain";
import { useLandingReaction } from "./useLandingReaction";
import { useBombBeat } from "./useBombBeat";
import type { LandingSignal } from "./useFlightClock";
import { CELLS, D, DRAW_STRIDE, SHEET, SPARK_LEN, SPRITE_R } from "./particleSprites";

// A chunk of its own: the rest air is not on the first paint's path, and the web first load is budgeted.
const MoteLayer = lazy(() => import("./moteLayer").then((m) => ({ default: m.MoteLayer })));

function bakeSheet(): HTMLCanvasElement {
  const sheet = document.createElement("canvas");
  sheet.width = SHEET.width;
  sheet.height = SHEET.height;
  const c = sheet.getContext("2d")!;
  c.fillStyle = c.strokeStyle = c.shadowColor = "#fff";
  for (const cell of CELLS) {
    const x = cell.x + cell.cx;
    const y = cell.y + cell.cy;
    c.shadowBlur = cell.glow * SPRITE_R;
    if (cell.shape === "soft") {
      const g = c.createRadialGradient(x, y, 0, x, y, SPRITE_R);
      g.addColorStop(0, "#fff");
      g.addColorStop(1, "rgba(0,0,0,0)");
      c.fillStyle = g;
      c.fillRect(x - SPRITE_R, y - SPRITE_R, SPRITE_R * 2, SPRITE_R * 2);
      c.fillStyle = "#fff";
    } else if (cell.shape === "spark") {
      c.lineWidth = 2 * SPRITE_R;
      c.lineCap = "round";
      c.beginPath();
      c.moveTo(x, y);
      c.lineTo(x + SPARK_LEN, y);
      c.stroke();
    } else {
      c.beginPath();
      c.arc(x, y, SPRITE_R, 0, Math.PI * 2);
      c.fill();
    }
  }
  return sheet;
}

function tinted(white: HTMLCanvasElement, rgb: string): HTMLCanvasElement {
  const out = document.createElement("canvas");
  out.width = white.width;
  out.height = white.height;
  const c = out.getContext("2d")!;
  c.drawImage(white, 0, 0);
  c.globalCompositeOperation = "source-in";
  c.fillStyle = `rgb(${rgb})`;
  c.fillRect(0, 0, out.width, out.height);
  return out;
}

function paintScene(c: CanvasRenderingContext2D, cv: HTMLCanvasElement, scene: BurstScene, paint: { white: HTMLCanvasElement | null; sheets: Map<string, HTMLCanvasElement> }, sx: number, sy: number) {
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, cv.width, cv.height);
  const white = paint.white!;
  const draws = scene.d;
  for (let i = 0; i < scene.s.live; i++) {
    const d = i * DRAW_STRIDE;
    if (!draws[d + D.a]) continue;
    const rgb = `${Math.round(draws[d + D.r] * 255)},${Math.round(draws[d + D.g] * 255)},${Math.round(draws[d + D.b] * 255)}`;
    let sheet = paint.sheets.get(rgb);
    if (!sheet) paint.sheets.set(rgb, (sheet = tinted(white, rgb)));
    c.setTransform(sx, 0, 0, sy, 0, 0);
    c.transform(draws[d + D.scos], draws[d + D.ssin], -draws[d + D.ssin], draws[d + D.scos], draws[d + D.tx], draws[d + D.ty]);
    c.globalAlpha = draws[d + D.a];
    c.drawImage(sheet, draws[d + D.x], draws[d + D.y], draws[d + D.w], draws[d + D.h], 0, 0, draws[d + D.w], draws[d + D.h]);
  }
  c.globalAlpha = 1;
}

export function ParticleLayer({ ref, rig, landing }: {
  ref?: Ref<ParticleEmitter>;
  rig: Pick<LampRig, "lamp" | "sx" | "sy"> & Partial<Pick<LampRig, "stillLight">>;
  landing: SharedValue<LandingSignal>;
}) {
  const { lamp, sx, sy } = rig;
  const [scene] = useState(() => createBurstScene());
  const [rng] = useState(tableRng);
  const paint = useRef({ white: null as HTMLCanvasElement | null, sheets: new Map<string, HTMLCanvasElement>() });
  const reduced = usePrefersReducedMotion();
  const canvas = useRef<HTMLCanvasElement | null>(null);
  // The canvas stays mounted and the frame callback released: a throw wakes it on the contact frame, and it releases itself when nothing flies.
  const [frame] = useState(() => (info: FrameInfo): boolean => {
    stepBurst(scene, lampNow(lamp.value), Math.min(0.05, (info.timeSincePreviousFrame ?? 0) / 1000), rng);
    const cv = canvas.current;
    const c = cv?.getContext?.("2d");
    if (cv && c) paintScene(c, cv, scene, paint.current, cv.width / DESIGN.width, cv.height / DESIGN.height);
    return !burstIdle(scene);
  });
  const wake = useDuring(frame, false);
  // Baked at mount, outside any burst: the offscreen draws it takes are not a turn's.
  useEffect(() => {
    if (!paint.current.white) paint.current.white = bakeSheet();
  }, []);
  useEffect(() => {
    const cv = canvas.current;
    if (!cv) return;
    cv.width = Math.round(DESIGN.width * sx);
    cv.height = Math.round(DESIGN.height * sy);
  }, [sx, sy]);
  useLandingReaction(landing, (l) => {
    "worklet";
    for (const p of landingDust(l, reduced, sx, sy, rng)) spawn(scene.s, p);
    wake();
  });
  useBombBeat(landing, reduced, (l) => {
    "worklet";
    for (const p of bombFx(l, reduced, sx, sy, rng)) spawn(scene.s, p);
    wake();
    traceOnset("moment", "bombFx");
  });

  useImperativeHandle(ref, () => ({
    emit(spawns) {
      for (const p of spawns) spawn(scene.s, p);
      wake();
    },
    ember(from, to) {
      if (reduced) return;
      startEmber(scene.ember, from, to);
      wake();
    },
    rain() {
      if (reduced) return;
      startRain(scene.rain);
      wake();
    },
  }), [scene, reduced, wake]);

  // The motes are live from the first frame, whether or not their chunk has loaded.
  useTraceSource("live", useCallback(() => scene.s.live + MOTES, [scene]));
  useTraceSource("dropped", useCallback(() => scene.s.dropped, [scene]));

  return (
    <>
      <Suspense fallback={null}>
        <MoteLayer rig={rig} />
      </Suspense>
      <canvas
        ref={canvas}
        data-testid="particles"
        style={{ position: "absolute", left: 0, top: 0, width: "100%", height: "100%", pointerEvents: "none" }}
      />
    </>
  );
}
