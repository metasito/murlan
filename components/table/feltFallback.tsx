// What the web table shows until CanvasKit is ready (#1252 § Rendering platform): the same cloth
// and rail, lit once per lamp target into one DOM canvas, with no per-frame lighting.
import { useEffect, useRef } from "react";
import type { FeltStops } from "@/lib/cosmetics";
import { DESIGN, LIGHT_ABOVE, lightUniforms, type LampTarget, type Pool } from "./lampRig";
import { CLOTH_GLSL, clothUniforms } from "./feltShader";
import { paintRail, RAIL_BAND, RAIL_LIGHT, ringRect, ROOM, type RingPainter } from "./rail";

const POOL_RADIUS = 420;
const QUAD = [-1, -1, 1, -1, -1, 1, 1, 1];
const VERTEX = "attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}";

function ringPath(c: CanvasRenderingContext2D, d: number) {
  const r = ringRect(d);
  c.roundRect(r.x, r.y, r.w, r.h, r.r);
}

function ringPainter(c: CanvasRenderingContext2D): RingPainter {
  return {
    ring(d, width, colour, dash) {
      c.beginPath();
      ringPath(c, d);
      c.lineWidth = width;
      c.strokeStyle = colour;
      c.setLineDash(dash?.intervals ?? []);
      c.lineDashOffset = dash?.phase ?? 0;
      c.stroke();
    },
  };
}

interface ClothRenderer {
  cv: HTMLCanvasElement;
  gl: WebGLRenderingContext;
  p: WebGLProgram;
}

let renderer: ClothRenderer | null | undefined;

/** One WebGL context for every bake: a page may hold only a few, and the cloth compiles once. */
function clothRenderer(): ClothRenderer | null {
  if (renderer?.gl.isContextLost()) renderer = undefined;
  if (renderer !== undefined) return renderer;
  const cv = document.createElement("canvas");
  const gl = cv.getContext("webgl", { premultipliedAlpha: true, antialias: false });
  if (!gl) return (renderer = null);
  const shader = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return s;
  };
  const p = gl.createProgram()!;
  gl.attachShader(p, shader(gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(p, shader(gl.FRAGMENT_SHADER, CLOTH_GLSL));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) return (renderer = null);
  gl.useProgram(p);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(QUAD), gl.STATIC_DRAW);
  const a = gl.getAttribLocation(p, "a");
  gl.enableVertexAttribArray(a);
  gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
  return (renderer = { cv, gl, p });
}

/** The cloth, `null` on a page with no WebGL (a felt without cloth, for good), `undefined` when the context was lost mid-draw. */
function drawCloth(width: number, height: number, uniforms: Record<string, number | number[]>, px: [number, number]): HTMLCanvasElement | null | undefined {
  const r = clothRenderer();
  if (!r) return null;
  const { cv, gl, p } = r;
  cv.width = width;
  cv.height = height;
  const all = { ...uniforms, uRes: [width, height], uPx: px };
  for (const [name, v] of Object.entries(all)) {
    const at = gl.getUniformLocation(p, name);
    if (typeof v === "number") gl.uniform1f(at, v);
    else if (v.length === 2) gl.uniform2fv(at, v);
    else gl.uniform3fv(at, v);
  }
  gl.viewport(0, 0, cv.width, cv.height);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  return gl.isContextLost() ? undefined : cv;
}

let grain: { key: string; cv: HTMLCanvasElement } | undefined;

/** The rail's wood, which no lamp moves: painted once per device scale, in the bake's own pixels. */
function grainLayer(width: number, height: number, ax: number, ay: number): HTMLCanvasElement | null {
  const key = `${width}x${height}@${ax},${ay}`;
  if (grain?.key === key) return grain.cv;
  const cv = document.createElement("canvas");
  cv.width = width;
  cv.height = height;
  const c = cv.getContext("2d");
  if (!c) return null;
  c.setTransform(ax, 0, 0, ay, 0, 0);
  paintRail(ringPainter(c));
  grain = { key, cv };
  return cv;
}

const MAX_DPR = 2;
/** 16 MB a copy: past it, five cached felts cost more memory than a re-bake costs time. */
const MAX_CACHED_PIXELS = 4_000_000;
/** One bake per place the lamp aims; `satisfies` makes a new `LampTarget` a compile error here. */
const LAMP_TARGETS = Object.keys({ top: 0, bottom: 0, left: 0, right: 0, centre: 0 } satisfies Record<LampTarget, 0>).length;

/** False when the bake came out incomplete (no 2D context, or a cloth lost mid-draw), which must not be cached. */
function bake(out: HTMLCanvasElement, stops: FeltStops, [tx, ty, reach]: Pool, sx: number, sy: number, dpr: number): boolean {
  const ax = dpr * sx;
  const ay = dpr * sy;
  out.width = Math.round(DESIGN.width * ax);
  out.height = Math.round(DESIGN.height * ay);
  const c = out.getContext("2d");
  if (!c) return false;
  const lx = tx;
  const ly = ty - LIGHT_ABOVE;
  c.setTransform(ax, 0, 0, ay, 0, 0);
  c.fillStyle = ROOM;
  c.fillRect(0, 0, DESIGN.width, DESIGN.height);

  const pool = c.createRadialGradient(lx, ly, 0, lx, ly, POOL_RADIUS);
  stops.forEach((s, i) => pool.addColorStop(i / (stops.length - 1), s));
  c.beginPath();
  ringPath(c, RAIL_BAND);
  c.fillStyle = pool;
  c.fill();

  const wood = grainLayer(out.width, out.height, ax, ay);
  if (wood) {
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.drawImage(wood, 0, 0);
    c.setTransform(ax, 0, 0, ay, 0, 0);
  }

  c.save();
  c.beginPath();
  ringPath(c, 0);
  ringPath(c, RAIL_BAND);
  c.clip("evenodd");
  c.globalCompositeOperation = "soft-light";
  const soft = c.createRadialGradient(lx, ly, 0, lx, ly, RAIL_LIGHT.softRadius);
  RAIL_LIGHT.soft(0).forEach((col, i) => soft.addColorStop(RAIL_LIGHT.softStops[i], col));
  c.fillStyle = soft;
  c.fillRect(0, 0, DESIGN.width, DESIGN.height);
  c.globalCompositeOperation = "source-over";
  const coat = c.createRadialGradient(lx, ly, 0, lx, ly, RAIL_LIGHT.coatRadius);
  RAIL_LIGHT.coat(0).forEach((col, i) => coat.addColorStop(i, col));
  c.beginPath();
  ringPath(c, RAIL_LIGHT.coatInset);
  c.lineWidth = RAIL_LIGHT.coatWidth;
  c.strokeStyle = coat;
  c.stroke();
  c.restore();

  const k = dpr * Math.min(sx, sy);
  const uniforms = { ...clothUniforms(stops, k), uLamp: [lx, ly], uFlare: 0, ...lightUniforms(reach) };
  const cloth = drawCloth(out.width, out.height, uniforms, [ax, ay]);
  if (cloth === undefined) return false;
  if (cloth) {
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.drawImage(cloth, 0, 0);
  }
  return true;
}

type Baked = Map<string, HTMLCanvasElement>;

function bakeCached(out: HTMLCanvasElement, cache: Baked, stops: FeltStops, pool: Pool, sx: number, sy: number) {
  const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
  const key = `${stops.join()}|${pool.join()}|${sx},${sy}|${dpr}`;
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    out.width = hit.width;
    out.height = hit.height;
    out.getContext("2d")?.drawImage(hit, 0, 0);
    return;
  }
  if (!bake(out, stops, pool, sx, sy, dpr) || out.width * out.height > MAX_CACHED_PIXELS) return;
  const copy = document.createElement("canvas");
  copy.width = out.width;
  copy.height = out.height;
  copy.getContext("2d")?.drawImage(out, 0, 0);
  if (cache.size >= LAMP_TARGETS) cache.delete(cache.keys().next().value!);
  cache.set(key, copy);
}

export function FeltFallback({
  stops,
  pool,
  sx,
  sy,
}: {
  stops: FeltStops;
  pool: Pool;
  sx: number;
  sy: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const cache = useRef<Baked>(new Map());
  const [px, py, reach] = pool;
  useEffect(() => {
    if (ref.current) bakeCached(ref.current, cache.current, stops, [px, py, reach], sx, sy);
  }, [stops, px, py, reach, sx, sy]);
  return (
    <canvas
      ref={ref}
      data-testid="felt-fallback"
      style={{ position: "absolute", left: 0, top: 0, width: "100%", height: "100%" }}
    />
  );
}
