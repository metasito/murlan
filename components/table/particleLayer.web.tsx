// The web's particle layer: one 2D canvas and one requestAnimationFrame loop, whether or not
// CanvasKit has loaded — the felt swaps renderers, this never does (#1252).
import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import type { SharedValue } from "react-native-reanimated";
import { traceOnset, useTraceSource } from "@/lib/e2eTrace";
import { usePrefersReducedMotion } from "@/lib/accessibility";
import { RestAir } from "@/lib/tokens";
import { createAir, mothPose, MOTES, stepAir, type Air, type MothPose } from "./air";
import { DESIGN, type Lamp } from "./lampRig";
import type { LampRig } from "./useLampRig";
import { createParticles, landDust, landingDustCount, PARTICLE_BUDGET, spawn, step, type ParticleEmitter, type Particles } from "./particles";
import { useLandingReaction } from "./useLandingReaction";
import type { LandingSignal } from "./useFlightClock";
import { CELLS, D, DRAW_STRIDE, layout, layoutMotes, SHEET, SPARK_LEN, SPRITE_R } from "./particleSprites";

interface AirView {
  air: Air;
  lit: number;
  moth: MothPose | null;
}

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

function animate(
  cv: HTMLCanvasElement,
  sim: Particles,
  view: AirView,
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
  const draws = new Float32Array(PARTICLE_BUDGET * DRAW_STRIDE);
  let last = performance.now();
  let id = requestAnimationFrame(function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    const l = lamp.value;
    last = now;
    step(sim, dt);
    if (stepAir(view.air, dt, l, reduced, Math.random)) traceOnset("moment", "moth");
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, cv.width, cv.height);
    layout(sim, draws);
    view.lit = layoutMotes(view.air, l, draws, sim.live);
    for (let i = 0; i < sim.live + MOTES; i++) {
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
    view.moth = mothPose(view.air, l);
    if (view.moth) {
      c.setTransform(k * sx, 0, 0, k * sy, 0, 0);
      drawMoth(c, view.moth);
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
  const [sim] = useState(() => createParticles());
  const [view] = useState((): AirView => ({ air: createAir(Math.random), lit: 0, moth: null }));
  const canvas = useRef<HTMLCanvasElement>(null);
  const reduced = usePrefersReducedMotion();
  useLandingReaction(landing, (l) => {
    "worklet";
    if (reduced || l.catchUp) return;
    for (const p of landDust(l.cards, landingDustCount(l.cards), l.x / sx, l.y / sy, Math.random)) spawn(sim, p);
  });

  useImperativeHandle(ref, () => ({
    emit(spawns) {
      for (const p of spawns) spawn(sim, p);
    },
  }), [sim]);

  useTraceSource("live", useCallback(() => sim.live + MOTES, [sim]));
  useTraceSource("dropped", useCallback(() => sim.dropped, [sim]));
  useTraceSource("motes", useCallback(() => view.lit, [view]));
  useTraceSource("moth", useCallback(() => view.moth && { x: view.moth.mx * sx, y: view.moth.my * sy }, [view, sx, sy]));

  useEffect(
    () => (canvas.current ? animate(canvas.current, sim, view, lamp, reduced, sx, sy) : undefined),
    [sim, view, lamp, reduced, sx, sy]
  );

  return (
    <canvas
      ref={canvas}
      data-testid="particles"
      style={{ position: "absolute", left: 0, top: 0, width: "100%", height: "100%", pointerEvents: "none" }}
    />
  );
}
