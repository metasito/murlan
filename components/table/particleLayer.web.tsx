// The web's particle layer: one 2D canvas and one requestAnimationFrame loop, whether or not
// CanvasKit has loaded — the felt swaps renderers, this never does (#1252).
import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import type { SharedValue } from "react-native-reanimated";
import { traceOnset, useTraceSource } from "@/lib/e2eTrace";
import { usePrefersReducedMotion } from "@/lib/accessibility";
import { RestAir } from "@/lib/tokens";
import { MOTES, type MothPose } from "./air";
import { DESIGN, type Lamp } from "./lampRig";
import type { LampRig } from "./useLampRig";
import { bombFx, landingDust, spawn, type ParticleEmitter } from "./particles";
import { startEmber } from "./ember";
import { startRain } from "./coneRain";
import { useLandingReaction } from "./useLandingReaction";
import { useBombBeat } from "./useBombBeat";
import type { LandingSignal } from "./useFlightClock";
import { CELLS, createScene, D, DRAW_STRIDE, sceneAsleep, SHEET, SPARK_LEN, SPRITE_R, stepScene, type Scene } from "./particleSprites";

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

function drawMoth(c: CanvasRenderingContext2D, p: MothPose) {
  c.fillStyle = RestAir.mothShadow;
  c.beginPath();
  c.ellipse(p.sx, p.sy, p.shadowRx, p.shadowRy, p.shadowRot, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = RestAir.moth;
  c.beginPath();
  c.ellipse(p.mx - p.wing, p.my, p.wing, p.wingRy, 0, 0, Math.PI * 2);
  c.ellipse(p.mx + p.wing, p.my, p.wing, p.wingRy, 0, 0, Math.PI * 2);
  c.fill();
}

export function animate(
  cv: HTMLCanvasElement,
  scene: Scene,
  lamp: SharedValue<Lamp>,
  reduced: boolean,
  sx: number,
  sy: number
): (() => void) | undefined {
  const c = cv.getContext("2d");
  if (!c) return;
  const k = window.devicePixelRatio || 1;
  cv.width = Math.round(DESIGN.width * sx * k);
  cv.height = Math.round(DESIGN.height * sy * k);
  const white = bakeSheet();
  const sheets = new Map<string, HTMLCanvasElement>();
  let last = performance.now();
  // Setting the size above cleared the canvas, so an asleep scene must still paint it once.
  let cleared = true;
  let id = requestAnimationFrame(function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    const l = lamp.value;
    last = now;
    if (!cleared && sceneAsleep(scene, l, reduced)) return void (id = requestAnimationFrame(frame));
    cleared = false;
    if (stepScene(scene, l, dt, reduced, Math.random)) traceOnset("moment", "moth");
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, cv.width, cv.height);
    const draws = scene.d;
    for (let i = 0; i < scene.s.live + MOTES; i++) {
      const d = i * DRAW_STRIDE;
      if (!draws[d + D.a]) continue;
      const rgb = `${Math.round(draws[d + D.r] * 255)},${Math.round(draws[d + D.g] * 255)},${Math.round(draws[d + D.b] * 255)}`;
      let sheet = sheets.get(rgb);
      if (!sheet) sheets.set(rgb, (sheet = tinted(white, rgb)));
      c.setTransform(k * sx, 0, 0, k * sy, 0, 0);
      c.transform(draws[d + D.scos], draws[d + D.ssin], -draws[d + D.ssin], draws[d + D.scos], draws[d + D.tx], draws[d + D.ty]);
      c.globalAlpha = draws[d + D.a];
      c.drawImage(sheet, draws[d + D.x], draws[d + D.y], draws[d + D.w], draws[d + D.h], 0, 0, draws[d + D.w], draws[d + D.h]);
    }
    c.globalAlpha = 1;
    if (scene.moth) {
      c.setTransform(k * sx, 0, 0, k * sy, 0, 0);
      drawMoth(c, scene.moth);
    }
    id = requestAnimationFrame(frame);
  });
  return () => cancelAnimationFrame(id);
}

export function ParticleLayer({ ref, rig, landing }: {
  ref?: Ref<ParticleEmitter>;
  rig: Pick<LampRig, "lamp" | "sx" | "sy">;
  landing: SharedValue<LandingSignal>;
}) {
  const { lamp, sx, sy } = rig;
  const [scene] = useState(() => createScene(Math.random));
  const canvas = useRef<HTMLCanvasElement>(null);
  const reduced = usePrefersReducedMotion();
  useLandingReaction(landing, (l) => {
    "worklet";
    for (const p of landingDust(l, reduced, sx, sy, Math.random)) spawn(scene.s, p);
  });
  useBombBeat(landing, reduced, (l) => {
    "worklet";
    for (const p of bombFx(l, reduced, sx, sy, Math.random)) spawn(scene.s, p);
    traceOnset("moment", "bombFx");
  });

  useImperativeHandle(ref, () => ({
    emit(spawns) {
      for (const p of spawns) spawn(scene.s, p);
    },
    ember(from, to) {
      if (!reduced) startEmber(scene.ember, from, to);
    },
    rain() {
      if (!reduced) startRain(scene.rain);
    },
  }), [scene, reduced]);

  useTraceSource("live", useCallback(() => scene.s.live + MOTES, [scene]));
  useTraceSource("dropped", useCallback(() => scene.s.dropped, [scene]));
  useTraceSource("motes", useCallback(() => scene.lit, [scene]));
  useTraceSource("moth", useCallback(() => scene.moth && { x: scene.moth.mx * sx, y: scene.moth.my * sy }, [scene, sx, sy]));

  useEffect(
    () => (canvas.current ? animate(canvas.current, scene, lamp, reduced, sx, sy) : undefined),
    [scene, lamp, reduced, sx, sy]
  );

  return (
    <canvas
      ref={canvas}
      data-testid="particles"
      style={{ position: "absolute", left: 0, top: 0, width: "100%", height: "100%", pointerEvents: "none" }}
    />
  );
}
