// The web's particle layer: one 2D canvas and one requestAnimationFrame loop, whether or not
// CanvasKit has loaded — the felt swaps renderers, this never does (#1252).
import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { useTraceSource } from "@/lib/e2eTrace";
import { DESIGN } from "./lampRig";
import { createParticles, PARTICLE_BUDGET, spawn, step, type ParticleEmitter, type Particles } from "./particles";
import { CELLS, D, DRAW_STRIDE, layout, SHEET, SPARK_LEN, SPRITE_R } from "./particleSprites";

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

function animate(cv: HTMLCanvasElement, sim: Particles, sx: number, sy: number): (() => void) | undefined {
  const c = cv.getContext("2d");
  if (!c) return;
  const k = window.devicePixelRatio || 1;
  cv.width = Math.round(DESIGN.width * sx * k);
  cv.height = Math.round(DESIGN.height * sy * k);
  const white = bakeSheet();
  const sheets = new Map<string, HTMLCanvasElement>();
  const draws = new Float32Array(PARTICLE_BUDGET * DRAW_STRIDE);
  let shown = 0;
  let last = performance.now();
  let id = requestAnimationFrame(function frame(now) {
    step(sim, Math.min(0.05, (now - last) / 1000));
    last = now;
    if (sim.live || shown) {
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, cv.width, cv.height);
      layout(sim, draws);
      for (let i = 0; i < sim.live; i++) {
        const d = i * DRAW_STRIDE;
        const rgb = `${Math.round(draws[d + D.r] * 255)},${Math.round(draws[d + D.g] * 255)},${Math.round(draws[d + D.b] * 255)}`;
        let sheet = sheets.get(rgb);
        if (!sheet) sheets.set(rgb, (sheet = tinted(white, rgb)));
        c.setTransform(k * sx, 0, 0, k * sy, 0, 0);
        c.transform(draws[d + D.scos], draws[d + D.ssin], -draws[d + D.ssin], draws[d + D.scos], draws[d + D.tx], draws[d + D.ty]);
        c.globalAlpha = draws[d + D.a];
        c.drawImage(sheet, draws[d + D.x], draws[d + D.y], draws[d + D.w], draws[d + D.h], 0, 0, draws[d + D.w], draws[d + D.h]);
      }
      c.globalAlpha = 1;
      shown = sim.live;
    }
    id = requestAnimationFrame(frame);
  });
  return () => cancelAnimationFrame(id);
}

export function ParticleLayer({ ref, sx, sy }: { ref: Ref<ParticleEmitter>; sx: number; sy: number }) {
  const [sim] = useState(() => createParticles());
  const canvas = useRef<HTMLCanvasElement>(null);

  useImperativeHandle(ref, () => ({
    emit(spawns) {
      for (const p of spawns) spawn(sim, p);
    },
  }), [sim]);

  useTraceSource("live", useCallback(() => sim.live, [sim]));
  useTraceSource("dropped", useCallback(() => sim.dropped, [sim]));

  useEffect(() => (canvas.current ? animate(canvas.current, sim, sx, sy) : undefined), [sim, sx, sy]);

  return (
    <canvas
      ref={canvas}
      data-testid="particles"
      style={{ position: "absolute", left: 0, top: 0, width: "100%", height: "100%", pointerEvents: "none" }}
    />
  );
}
