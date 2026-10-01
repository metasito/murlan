// The felt's shadow pass (#1260): every table card's shadow, drawn from the card registry.
//
// JSX-free, runtime imports relative — docs/agents/checks.md, "Node's TypeScript loader".

import { CardShadow } from "../../lib/tokens.ts";
import { cardRadius } from "../cardFaceModel.ts";
import type { CardRect, CardRects, Felt, Point } from "./cardRects.ts";
import { LIGHT_ABOVE, type Pool } from "./lampRig.ts";

export type ShadowKind = "face" | "back" | "fan";
/** One path each; the cast is every face and back, a seat fan's backs cast nothing (`.bk`). */
export const SHADOW_PATHS = ["cast", "face", "back", "fan"] as const;
export type ShadowPath = (typeof SHADOW_PATHS)[number];

export function shadowKind(key: string, rect: CardRect): ShadowKind {
  "worklet";
  if (key.startsWith("fan:")) return "fan";
  return rect.back ? "back" : "face";
}

export function inPath(path: ShadowPath, kind: ShadowKind): boolean {
  "worklet";
  return path === "cast" ? kind !== "fan" : path === kind;
}

/** `--shx`/`--shy` in design points at card scale 1, from the pile and the light point in design points. */
export function castOffset(pile: Point, light: Point): Point {
  "worklet";
  return { x: (pile.x - light.x) / CardShadow.fall.x, y: CardShadow.fall.drop + (pile.y - light.y) / CardShadow.fall.y };
}

/** The web fallback's still cast in window points, the light where the lamp is headed. */
export function restingCast(pile: Point, pool: Pool, felt: Pick<Felt, "sx" | "sy" | "s">): Point {
  const o = castOffset({ x: pile.x / felt.sx, y: pile.y / felt.sy }, { x: pool[0], y: pool[1] - LIGHT_ABOVE });
  return { x: o.x * felt.s, y: o.y * felt.s };
}

/** CSS's blur is twice the Gaussian's sigma, which Skia takes; `s` the card scale. */
export function shadowPaint(path: ShadowPath, s: number): { sigma: number; alpha: number } {
  "worklet";
  if (path === "cast") return { sigma: (CardShadow.cast.blur / 2) * s, alpha: CardShadow.cast.alpha };
  return { sigma: (CardShadow.contact.blur / 2) * s, alpha: CardShadow.alpha[path] };
}

/** A path's offset from its cards in design points at card scale 1; `pile` and `light` in design points. */
export function shadowFall(path: ShadowPath, pile: Point, light: Point): Point {
  "worklet";
  return path === "cast" ? castOffset(pile, light) : { x: 0, y: CardShadow.contact.y };
}

export type ShadowTransform = [{ scaleX: number }, { scaleY: number }, { translateX: number }, { translateY: number }];

/** Inside the felt's design-space group: back to window points, where the outlines are, then the fall at card scale. */
export function shadowTransform(fall: Point, felt: Pick<Felt, "sx" | "sy" | "s">): ShadowTransform {
  "worklet";
  return [{ scaleX: 1 / felt.sx }, { scaleY: 1 / felt.sy }, { translateX: fall.x * felt.s }, { translateY: fall.y * felt.s }];
}

export interface PathSink {
  moveTo(x: number, y: number): unknown;
  lineTo(x: number, y: number): unknown;
  conicTo(x1: number, y1: number, x2: number, y2: number, w: number): unknown;
  close(): unknown;
}

const CORNER = cardRadius(1);
const QUARTER = Math.SQRT1_2;

/** In window points. A card its row's window cuts keeps the part toward `midX`, that row's middle. */
export function addOutline(sink: PathSink, r: CardRect, felt: Pick<Felt, "sx" | "sy" | "s">, midX: number): void {
  "worklet";
  if (r.seen <= 0) return;
  const w = r.w * felt.s;
  const cx = r.x * felt.sx;
  const cy = r.y * felt.sy;
  const a = (w * r.seen) / 2;
  const b = (r.h * felt.s) / 2;
  const o = Math.sign(midX - cx) * (w / 2 - a);
  const k = Math.min(CORNER * w, a, b);
  const t = (r.rot * Math.PI) / 180;
  const cos = Math.cos(t);
  const sin = Math.sin(t);
  const X = (x: number, y: number) => cx + (o + x) * cos - y * sin;
  const Y = (x: number, y: number) => cy + (o + x) * sin + y * cos;
  sink.moveTo(X(k - a, -b), Y(k - a, -b));
  sink.lineTo(X(a - k, -b), Y(a - k, -b));
  sink.conicTo(X(a, -b), Y(a, -b), X(a, k - b), Y(a, k - b), QUARTER);
  sink.lineTo(X(a, b - k), Y(a, b - k));
  sink.conicTo(X(a, b), Y(a, b), X(a - k, b), Y(a - k, b), QUARTER);
  sink.lineTo(X(k - a, b), Y(k - a, b));
  sink.conicTo(X(-a, b), Y(-a, b), X(-a, b - k), Y(-a, b - k), QUARTER);
  sink.lineTo(X(-a, k - b), Y(-a, k - b));
  sink.conicTo(X(-a, -b), Y(-a, -b), X(k - a, -b), Y(k - a, -b), QUARTER);
  sink.close();
}

export function buildShadow(sink: PathSink, path: ShadowPath, rects: CardRects, felt: Pick<Felt, "sx" | "sy" | "s">, midX: number): void {
  "worklet";
  for (const key of Object.keys(rects)) {
    const r = rects[key];
    if (inPath(path, shadowKind(key, r))) addOutline(sink, r, felt, midX);
  }
}
