// tests/ui-rules/cardRects.test.ts — each owner's transform, from its own layout maths to the felt's
// design space (#1259 plan 4, task 11). Positions on screen are tests/e2e/cardRects.spec.ts's.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dealBackRect,
  designRect,
  fanBackRects,
  handCardRect,
  legCardRect,
  pileCardRect,
  type CardRect,
} from "../../components/table/cardRects.ts";
import { seatFanArc } from "../../components/fanGeometry.ts";
import { CARD_BACK_H, CARD_BACK_W } from "../../components/cardFaceModel.ts";
import { FAN_DRAWN_CARDS } from "../../components/seatLayout.ts";

const FELT = { sx: 2, sy: 0.5 };
const PILE = { x: 400, y: 200 };
const REST = { tx: 0, ty: 0, scale: 1, drop: 0, rot: 0 };
const STILL = { scale: 1, rot: 0 };
const close = (a: number, b: number, what: string) => assert.ok(Math.abs(a - b) < 1e-9, `${what}: ${a} is not ${b}`);
const at = (r: CardRect) => ({ x: r.x * FELT.sx, y: r.y * FELT.sy });

test("design space is the window per axis, and a card's size goes with its axis", () => {
  const r = designRect({ cx: 100, cy: 100, w: 60, h: 90, rot: 5, back: false, lift: 0, glow: 0 }, FELT);
  assert.deepEqual([r.x, r.y, r.w, r.h, r.rot], [50, 200, 30, 180, 5]);
});

test("a hand card sits at its box in the row, moved by its transform, the pan and the zone's lift", () => {
  const card = { left: 10, bottom: -5, w: 40, h: 60, tx: 3, ty: -4, rot: 2, scale: 1, back: false, lift: 1.2, glow: 0.5 };
  const r = handCardRect({ x: 100, y: 300, ...FELT }, card, 2, -6);
  close(at(r).x, 100 + 10 + 20 + 3 - 2, "x");
  close(at(r).y, 300 - 6 + 5 - 30 - 4, "y");
  assert.equal(r.lift, 1, "lift is clamped to 1");
  assert.equal(r.glow, 0.5);
});

test("a played card turns with its group about the pile's centre, never about its own", () => {
  const card = { slotX: 0, slotY: 0, x: 30, y: 0, rot: 0, scale: 1, liftY: 0, w: 60, h: 90, lift: 0, glow: 0 };
  const r = pileCardRect(PILE, FELT, { ...REST, rot: 90 }, STILL, card);
  close(at(r).x, PILE.x, "x");
  close(at(r).y, PILE.y + 30, "y");
  close(r.rot, 90, "rot");
});

test("the sweep's travel is outside its scale; the beaten drop is inside it", () => {
  const card = { slotX: 0, slotY: 0, x: 20, y: 0, rot: 0, scale: 1, liftY: 0, w: 60, h: 90, lift: 0, glow: 0 };
  const r = pileCardRect(PILE, FELT, { tx: 100, ty: -50, scale: 0.5, drop: 10, rot: 0 }, STILL, card);
  close(at(r).x, PILE.x + 100 + 0.5 * 20, "x");
  close(at(r).y, PILE.y - 50 + 0.5 * 10, "y");
  close(r.w * FELT.sx, 30, "w");
});

test("the catch lifts a card in its own frame, and the wobble and the throw's scale multiply", () => {
  const card = { slotX: 5, slotY: 0, x: 0, y: 0, rot: 90, scale: 2, liftY: -9, w: 60, h: 90, lift: 0.4, glow: 0.4 };
  const r = pileCardRect(PILE, FELT, REST, { scale: 1.5, rot: 0 }, card);
  close(at(r).x, PILE.x + 1.5 * (5 + 18), "x");
  close(at(r).y, PILE.y, "y");
  close(r.h * FELT.sy, 90 * 3, "h");
});

test("a dealt back and a traded card sit on the pile's offsets, a flipped card narrowed by its turn", () => {
  const d = dealBackRect(PILE, FELT, { dx: -40, dy: 60, rot: 90 }, 30, 44);
  assert.deepEqual([at(d).x, at(d).y, d.rot, d.back], [360, 260, 90, true]);
  const l = legCardRect(PILE, FELT, { x: 12, y: -8, rot: 3, scale: 0.5, flip: -0.4, face: false }, 30, 44);
  assert.deepEqual([at(l).x, at(l).y, l.back], [412, 192, true]);
  close(l.w * FELT.sx, 30 * 0.5 * 0.4, "w");
  close(l.h * FELT.sy, 44 * 0.5, "h");
});

/** The box a turned card covers, the way `arcBounds` measures one. */
function extent(rects: CardRect[]) {
  let [x0, x1, y0, y1] = [Infinity, -Infinity, Infinity, -Infinity];
  for (const r of rects) {
    const rad = (r.rot * Math.PI) / 180;
    const [w, h] = [r.w * FELT.sx, r.h * FELT.sy];
    const hx = (w * Math.abs(Math.cos(rad)) + h * Math.abs(Math.sin(rad))) / 2;
    const hy = (w * Math.abs(Math.sin(rad)) + h * Math.abs(Math.cos(rad))) / 2;
    const { x, y } = at(r);
    [x0, x1, y0, y1] = [Math.min(x0, x - hx), Math.max(x1, x + hx), Math.min(y0, y - hy), Math.max(y1, y + hy)];
  }
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 };
}

test("an unleaned fan covers exactly the box `CardFan` reserves for it, centred on its point", () => {
  const backScale = 0.9;
  const flat = { count: 12, backScale, leanDeg: 0, perspective: 560 };
  const { bounds } = seatFanArc(FAN_DRAWN_CARDS.top, backScale);
  const top = fanBackRects(PILE, FELT, { side: "top", ...flat });
  assert.equal(top.length, FAN_DRAWN_CARDS.top, "drawn at the cap, never the count");
  const e = extent(top);
  close(e.cx, PILE.x, "cx");
  close(e.cy, PILE.y, "cy");
  close(e.w, bounds.w, "w");
  close(e.h, bounds.h, "h");
  const side = extent(fanBackRects(PILE, FELT, { side: "left", ...flat, count: 3 }));
  const three = seatFanArc(3, backScale).bounds;
  close(side.w, three.h, "a side fan is turned a quarter");
  close(side.h, three.w, "a side fan is turned a quarter");
});

test("a leaned fan foreshortens along the lean and shrinks what recedes", () => {
  const fan = { side: "top" as const, count: 1, backScale: 1, perspective: 560 };
  const [flat] = fanBackRects(PILE, FELT, { ...fan, leanDeg: 0 });
  const [leaned] = fanBackRects(PILE, FELT, { ...fan, leanDeg: -17 });
  close(flat.w * FELT.sx, CARD_BACK_W(1), "flat w");
  close(flat.h * FELT.sy, CARD_BACK_H(1), "flat h");
  close(leaned.h / leaned.w, (CARD_BACK_H(1) * Math.cos((17 * Math.PI) / 180)) / CARD_BACK_W(1) / (FELT.sy / FELT.sx), "leaned aspect");
});
