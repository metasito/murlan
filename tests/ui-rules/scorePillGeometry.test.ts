import { test } from "node:test";
import assert from "node:assert/strict";
import { scorePillBox, scorePillFades, scorePillHeader, scorePillHitBox, scorePillLift, scorePillRow } from "../../components/table/scorePillModel.ts";

// The Lantern Table's own frame: `RIGHT = 846.2`, `y = 13.4`, `BOARD = {x:237, y:72}` at 874 × 402.
const MOCKUP = { right: 846.2, top: 13.4, restH: 23.7, centreX: 457, unit: 1 };

const close = <T extends object>(actual: T, expected: Partial<Record<keyof T, number>>) => {
  for (const [k, v] of Object.entries(expected) as [keyof T, number][]) {
    const got = actual[k] as number;
    assert.ok(Math.abs(got - v) < 1e-6, `${String(k)}: ${got} against ${v}`);
  }
};

test("the box follows renderScore's lerps between the pill, the panel and the board", () => {
  close(scorePillBox(0, 0, MOCKUP), { x: 722.2, y: 13.4, w: 124, h: 23.7, radius: 11.85 });
  close(scorePillBox(0.5, 0, MOCKUP), { x: 666.2, y: 13.4, w: 180, h: 75.85, radius: 11.925 });
  close(scorePillBox(1, 0, MOCKUP), { x: 610.2, y: 13.4, w: 236, h: 128, radius: 12 });
  close(scorePillBox(1.1, 0, MOCKUP), { w: 247.2, radius: 12 });
  close(scorePillBox(1, 0.5, MOCKUP), { x: 423.6, y: 42.7, w: 338, h: 190, radius: 14 });
  close(scorePillBox(1, 1, MOCKUP), { x: 237, y: 72, w: 440, h: 252, radius: 16 });
});

test("the press target is 44 pt tall around the pill at rest, and the panel itself when open", () => {
  close(scorePillHitBox(0, 0, MOCKUP, 44), { x: 722.2, y: 3.25, w: 124, h: 44 });
  close(scorePillHitBox(1, 0, MOCKUP, 44), { x: 610.2, y: 3.25, w: 236, h: 138.15 });
});

test("the chip fades out in the first third of the open, the panel in from .3 to .8", () => {
  close(scorePillFades(0.2, 0), { chip: 0.4, panel: 0 });
  close(scorePillFades(0.55, 0), { chip: 0, panel: 0.5 });
  close(scorePillFades(0, 0.1), { chip: 0, panel: 1 });
});

test("a row stands at its place, and moves and grows toward the board", () => {
  close(scorePillRow(2, 0, 1), { x: 8, y: 74, scale: 1 });
  close(scorePillRow(2, 1, 1), { x: 162, y: 122, scale: 1.2 });
  close(scorePillRow(1, 0, 2), { x: 16, y: 100, scale: 1 });
  close(scorePillHeader(0, 1), { x: 12, y: 8 });
  close(scorePillHeader(1, 1), { x: 164, y: 18 });
});

test("the shadow lifts with whichever of open and board is further along", () => {
  assert.equal(scorePillLift(0, 0), 0);
  assert.equal(scorePillLift(0.5, 1), 1);
  assert.equal(scorePillLift(1.1, 0), 1);
});
