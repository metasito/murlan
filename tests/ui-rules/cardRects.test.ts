// tests/ui-rules/cardRects.test.ts — each owner's transform, from its own layout maths to the felt's
// design space (#1259 plan 4, task 11). Positions on screen are tests/e2e/cardRects.spec.ts's.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  TABLE_AT_REST,
  dealBack,
  designRect,
  fanBacks,
  handCard,
  legCard,
  panShown,
  pileCard,
  type DrawnCard,
} from "../../components/table/cardRects.ts";
import { seatFanArc } from "../../components/fanGeometry.ts";
import { CARD_BACK_H, CARD_BACK_W } from "../../components/cardFaceModel.ts";
import { FAN_DRAWN_CARDS } from "../../components/seatLayout.ts";

const FELT = { sx: 2, sy: 0.5, s: 1.25, kickAt: { x: 500, y: 200 }, shakeAt: { x: 480, y: 190 } };
const PILE = { x: 400, y: 200 };
const REST = { tx: 0, ty: 0, scale: 1, drop: 0, rot: 0 };
const STILL = { scale: 1, rot: 0 };
const close = (a: number, b: number, what: string) => assert.ok(Math.abs(a - b) < 1e-9, `${what}: ${a} is not ${b}`);
const card = (cx: number, cy: number, rot = 0): DrawnCard => ({ cx, cy, w: 60, h: 90, rot, back: false, lift: 0, glow: 0 });

test("the centre maps per axis; the size by the one card scale, so a turned card keeps its shape", () => {
  const r = designRect(card(100, 100, 90), FELT, TABLE_AT_REST);
  assert.deepEqual([r.x, r.y, r.w, r.h, r.rot, r.seen], [50, 200, 48, 72, 90, 1]);
  close(r.h / r.w, 90 / 60, "aspect");
});

test("the kick scales about its own point and moves; the shake turns about the table's centre inside it", () => {
  const kick = { ...TABLE_AT_REST, kx: 9, ky: -5, ks: 1.012 };
  const onKick = designRect(card(FELT.kickAt.x, FELT.kickAt.y), FELT, kick);
  close(onKick.x * FELT.sx, FELT.kickAt.x + 9, "the kick's own point only moves");
  const off = designRect(card(FELT.kickAt.x + 100, FELT.kickAt.y), FELT, kick);
  close(off.x * FELT.sx, FELT.kickAt.x + 9 + 101.2, "and the rest scales away from it");
  close(off.w * FELT.s, 60 * 1.012, "the kick's scale reaches the card");

  const shake = { ...TABLE_AT_REST, shx: 2, shy: 3, shr: 90 };
  const r = designRect(card(FELT.shakeAt.x + 10, FELT.shakeAt.y), FELT, shake);
  close(r.x * FELT.sx, FELT.shakeAt.x + 2, "x");
  close(r.y * FELT.sy, FELT.shakeAt.y + 3 + 10, "y");
  close(r.rot, 90, "the shake's turn is the card's");
});

test("a hand card sits at its box in the row, moved by its transform, the pan and the zone's lift", () => {
  const c = { left: 10, bottom: -5, w: 40, h: 60, tx: 3, ty: -4, rot: 2, scale: 1, back: false, lift: 1.2, glow: 0.5 };
  const d = handCard({ x: 100, y: 300, clipX: 0, clipHalf: 0 }, c, 2, -6);
  close(d.cx, 100 + 10 + 20 + 3 - 2, "x");
  close(d.cy, 300 - 6 + 5 - 30 - 4, "y");
  const r = designRect(d, FELT, TABLE_AT_REST);
  assert.equal(r.lift, 1, "lift is clamped to 1");
  assert.equal(r.seen, 1);
  assert.equal(panShown(50, 20), 20);
  assert.equal(panShown(-50, 20), -20);
});

test("a scrolled hand's card says how much of it the window shows", () => {
  const c = { left: 0, bottom: 0, w: 40, h: 60, tx: 0, ty: 0, rot: 0, scale: 1, back: false, lift: 0, glow: 0 };
  const row = { x: 100, y: 300, clipX: 200, clipHalf: 90 };
  close(handCard(row, c, 0, 0).seen!, 30 / 40, "three quarters past the window's left edge");
  close(handCard(row, c, -30, 0).seen!, 1, "panned fully in");
  assert.equal(designRect(handCard(row, c, 60, 0), FELT, TABLE_AT_REST).seen, 0);
});

test("a played card turns with its group about the pile's centre, never about its own", () => {
  const c = { slotX: 0, slotY: 0, x: 30, y: 0, rot: 0, scale: 1, liftY: 0, w: 60, h: 90, lift: 0, glow: 0 };
  const d = pileCard(PILE, { ...REST, rot: 90 }, STILL, c);
  close(d.cx, PILE.x, "x");
  close(d.cy, PILE.y + 30, "y");
  close(d.rot, 90, "rot");
});

test("the sweep's travel is outside its scale; the beaten drop is inside it", () => {
  const c = { slotX: 0, slotY: 0, x: 20, y: 0, rot: 0, scale: 1, liftY: 0, w: 60, h: 90, lift: 0, glow: 0 };
  const d = pileCard(PILE, { tx: 100, ty: -50, scale: 0.5, drop: 10, rot: 0 }, STILL, c);
  close(d.cx, PILE.x + 100 + 0.5 * 20, "x");
  close(d.cy, PILE.y - 50 + 0.5 * 10, "y");
  close(d.w, 30, "w");
});

test("the catch lifts a card in its own frame, and the wobble and the throw's scale multiply", () => {
  const c = { slotX: 5, slotY: 0, x: 0, y: 0, rot: 90, scale: 2, liftY: -9, w: 60, h: 90, lift: 0.4, glow: 0.4 };
  const d = pileCard(PILE, REST, { scale: 1.5, rot: 0 }, c);
  close(d.cx, PILE.x + 1.5 * (5 + 18), "x");
  close(d.cy, PILE.y, "y");
  close(d.h, 90 * 3, "h");
});

test("a dealt back and a traded card sit on the pile's offsets, a flipped card narrowed by its turn", () => {
  const d = dealBack(PILE, { dx: -40, dy: 60, rot: 90 }, 30, 44);
  assert.deepEqual([d.cx, d.cy, d.rot, d.back], [360, 260, 90, true]);
  const l = legCard(PILE, { x: 12, y: -8, rot: 3, scale: 0.5, flip: -0.4, face: false }, 30, 44);
  assert.deepEqual([l.cx, l.cy, l.back], [412, 192, true]);
  close(l.w, 30 * 0.5 * 0.4, "w");
  close(l.h, 44 * 0.5, "h");
});

test("the hand clamps its pan in one place: the row's shift, every card's rectangle and the throw's origin", () => {
  const src = readFileSync(new URL("../../components/table/hand.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(src, /Math\.(min|max)\(Math\.(min|max)\(pan/);
  assert.equal(src.match(/panShown\((place\.pan\.value|pan\.value|heldPlace\.pan\.value|pan\.get\(\))/g)?.length, 4);
});

/** The box a turned card covers, the way `arcBounds` measures one. */
function extent(cards: DrawnCard[]) {
  let [x0, x1, y0, y1] = [Infinity, -Infinity, Infinity, -Infinity];
  for (const c of cards) {
    const rad = (c.rot * Math.PI) / 180;
    const hx = (c.w * Math.abs(Math.cos(rad)) + c.h * Math.abs(Math.sin(rad))) / 2;
    const hy = (c.w * Math.abs(Math.sin(rad)) + c.h * Math.abs(Math.cos(rad))) / 2;
    [x0, x1, y0, y1] = [Math.min(x0, c.cx - hx), Math.max(x1, c.cx + hx), Math.min(y0, c.cy - hy), Math.max(y1, c.cy + hy)];
  }
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 };
}

test("an unleaned fan covers exactly the box `CardFan` reserves for it, centred on its point", () => {
  const backScale = 0.9;
  const flat = { count: 12, backScale, leanDeg: 0, perspective: 560 };
  const { bounds } = seatFanArc(FAN_DRAWN_CARDS.top, backScale);
  const top = fanBacks(PILE, { side: "top", ...flat });
  assert.equal(top.length, FAN_DRAWN_CARDS.top, "drawn at the cap, never the count");
  const e = extent(top);
  close(e.cx, PILE.x, "cx");
  close(e.cy, PILE.y, "cy");
  close(e.w, bounds.w, "w");
  close(e.h, bounds.h, "h");
  const side = extent(fanBacks(PILE, { side: "left", ...flat, count: 3 }));
  const three = seatFanArc(3, backScale).bounds;
  close(side.w, three.h, "a side fan is turned a quarter");
  close(side.h, three.w, "a side fan is turned a quarter");
});

test("a leaned fan foreshortens along the lean and shrinks what recedes", () => {
  const fan = { side: "top" as const, count: 1, backScale: 1, perspective: 560 };
  const [flat] = fanBacks(PILE, { ...fan, leanDeg: 0 });
  const [leaned] = fanBacks(PILE, { ...fan, leanDeg: -17 });
  close(flat.w, CARD_BACK_W(1), "flat w");
  close(flat.h, CARD_BACK_H(1), "flat h");
  close(leaned.h / leaned.w, (CARD_BACK_H(1) * Math.cos((17 * Math.PI) / 180)) / CARD_BACK_W(1), "leaned aspect");
});
