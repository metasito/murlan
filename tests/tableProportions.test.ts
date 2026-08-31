// tests/tableProportions.test.ts — the table keeps its proportions from the
// smallest phone to the largest tablet, rather than growing one gap (#586).
//
// The band between the seat plates and the hand is a *leftover*: whatever the
// window has after the top seat's column and the hand zone have taken theirs.
// So it grows whenever anything above or below it fails to grow with the rest,
// and the layout used to mix two kinds of length — multiples of `cardScale`,
// and flat numbers chosen at phone scale. At scale 0.82 a flat 16 is a real
// share of the stack; at 2.14 it is noise, and every pixel of that difference
// landed here.
//
// Pure geometry, so this runs under `node --test` in milliseconds and covers
// sizes nobody photographs. It cannot see a layout bug — only the browser can —
// but this class of defect is arithmetic, and arithmetic is exactly what a
// browser is the most expensive possible way to check.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  computeTableFrame,
  seatLabelH,
  seatGap,
  surplusHeight,
  SEAT_DISC,
  HAND_ZONE_H,
} from "../components/gameTableModel.ts";
import { cardScale, CARD_H } from "../components/cardFaceModel.ts";

/** The ticket's own list: two phones, a large phone, and two tablets. */
const VIEWPORTS = [
  { name: "iPhone SE landscape", width: 568, height: 320 },
  { name: "iPhone 12 landscape", width: 844, height: 390 },
  { name: "iPhone Pro Max landscape", width: 956, height: 440 },
  { name: "iPad landscape", width: 1112, height: 834 },
  { name: "iPad Pro landscape", width: 1366, height: 1024 },
];

const NO_INSETS = { top: 0, bottom: 0, left: 0, right: 0 };

/**
 * The band, from the same three pieces `flightOrigin` derives it from: what is
 * left of the content height once the top seat's column and the hand zone have
 * taken theirs. The top fan is left out deliberately — it is the one piece that
 * varies with how many cards an opponent holds, and a proportion that only
 * holds at one hand size is not a proportion.
 */
function band(width: number, height: number) {
  const scale = cardScale(Math.min(width, height));
  const frame = computeTableFrame({ width, height, insets: NO_INSETS, scale });
  const topSectionH = seatLabelH(scale) + SEAT_DISC * scale + seatGap(scale);
  const handZoneH = HAND_ZONE_H(CARD_H(scale), frame.bottomPad, scale);
  const contentH = height - frame.tableTop - frame.tableBottom;
  // Against the height the table was *scaled* for, not the window's: past the
  // scale cap those differ, and measuring a capped table against a window it
  // was never sized to fill reads the deliberate surplus as a missing band.
  const drawnH = height - surplusHeight(width, height, scale);
  return { scale, frame, share: (contentH - topSectionH - handZoneH) / drawnH };
}

describe("the table keeps its proportions from phone to tablet", () => {
  // The whole ticket in one assertion. Before the fix these ran 53.4%, 54.9%,
  // 55.6%, 58.4%, 63.7% — a monotonic climb of more than ten points.
  test("the band between the seats and the hand is the same share at every size", () => {
    const shares = VIEWPORTS.map((vp) => ({ ...vp, ...band(vp.width, vp.height) }));
    const smallest = Math.min(...shares.map((s) => s.share));
    const largest = Math.max(...shares.map((s) => s.share));

    assert.ok(
      largest - smallest < 0.015,
      `the band must hold its share of the height at every size, and spans ${(
        (largest - smallest) * 100
      ).toFixed(1)} points:\n` +
        shares
          .map((s) => `  ${s.name.padEnd(26)} ${(s.share * 100).toFixed(1)}%`)
          .join("\n")
    );
  });

  // The floor. A band that is a constant share of *nothing* would satisfy the
  // assertion above, and so would one that filled the screen.
  test("and it is a real band, not zero and not the whole screen", () => {
    for (const vp of VIEWPORTS) {
      const { share } = band(vp.width, vp.height);
      assert.ok(share > 0.3 && share < 0.7, `${vp.name}: band is ${(share * 100).toFixed(1)}%`);
    }
  });

  // `cardScale` caps at MAX_SHORT_EDGE, so past it the window keeps growing and
  // the contents do not. That height has to be accounted for somewhere; left to
  // itself it all went to the band, which is what made the largest tablet the
  // worst of the five.
  test("height the scale cap leaves over becomes pad, not band", () => {
    const pro = VIEWPORTS[4];
    const scale = cardScale(Math.min(pro.width, pro.height));
    const over = surplusHeight(pro.width, pro.height, scale);
    assert.ok(over > 0, "the iPad Pro is past the scale cap, or this test checks nothing");

    const frame = computeTableFrame({
      width: pro.width,
      height: pro.height,
      insets: NO_INSETS,
      scale,
    });
    assert.ok(
      frame.tableTop > over / 2 && frame.tableBottom > over / 2,
      `the surplus (${over}px) must sit in the pads: top ${frame.tableTop}, bottom ${frame.tableBottom}`
    );
  });

  test("no phone has any surplus — the cap only bites on a large tablet", () => {
    for (const vp of VIEWPORTS.slice(0, 3)) {
      const scale = cardScale(Math.min(vp.width, vp.height));
      assert.equal(surplusHeight(vp.width, vp.height, scale), 0, vp.name);
    }
  });

  // Portrait is not a state the table lays out in, and there the height is the
  // long edge — reading the difference between the two as surplus would push
  // the whole table off its own screen.
  test("portrait reports no surplus, whatever the window", () => {
    for (const vp of VIEWPORTS) {
      const scale = cardScale(Math.min(vp.width, vp.height));
      assert.equal(surplusHeight(vp.height, vp.width, scale), 0, `${vp.name} rotated`);
    }
  });
});

describe("the width the table does not use", () => {
  // #586 reports 148px of unused width at 1112x834 and asks for it to be used
  // or shown deliberate. It is the rail plus the far margin, and the rail is
  // sized to hold a knob that scales with the table — so it is holding
  // something. This pins that it stays that way: a rail that grew past what it
  // carries would be the defect the ticket suspected.
  const KNOB = (scale: number) => Math.max(44, 44 * scale);

  test("the rail is wide enough for its knob, and not much wider, at every size", () => {
    for (const vp of VIEWPORTS) {
      const scale = cardScale(Math.min(vp.width, vp.height));
      const { rail } = computeTableFrame({
        width: vp.width,
        height: vp.height,
        insets: NO_INSETS,
        scale,
      });
      const knob = KNOB(scale);
      assert.ok(rail >= knob, `${vp.name}: rail ${rail} cannot hold a ${knob} knob`);
      assert.ok(
        rail <= knob * 1.4,
        `${vp.name}: rail ${rail} is more than a knob (${knob}) plus air — it is margin pretending to be chrome`
      );
    }
  });
});
