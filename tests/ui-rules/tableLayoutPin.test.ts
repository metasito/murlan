// tests/ui-rules/tableLayoutPin.test.ts — tableLayout on every viewport and safe area must land on
// the places pinned in tests/fixtures/tableLayout.json, which today's functions computed.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { BASE_SHORT_EDGE, cardScale, CARD_H, HAND_SCALE } from "../../components/cardFaceModel.ts";
import { anchorPoints, floatTop, seatPoint, tableGeometry } from "../../components/flightPhysics.ts";
import { CHIP_H } from "../../components/seatLayout.ts";
import { mockupPx } from "../../components/table/noticeModel.ts";
import { MOCKUP_SHORT_EDGE, scorePillBox, voteTop } from "../../components/table/scorePillModel.ts";
import { bannerTop, computeTableFrame, notificationTopOffset, surplusHeight, type EdgeInsets } from "../../components/tableFrame.ts";
import { tableLayout } from "../../components/tableLayout.ts";

const VIEWPORTS = [
  { name: "iPhone SE landscape", width: 568, height: 320 },
  { name: "iPhone 12 landscape", width: 844, height: 390 },
  { name: "iPhone Pro Max landscape", width: 956, height: 440 },
  { name: "iPad landscape", width: 1112, height: 834 },
  { name: "iPad Pro landscape", width: 1366, height: 1024 },
];

const INSETS: Record<string, EdgeInsets> = {
  none: { top: 0, bottom: 0, left: 0, right: 0 },
  "island and home bar": { top: 0, left: 62, bottom: 21, right: 62 },
  island: { top: 0, left: 62, bottom: 0, right: 0 },
  "status bar and notch": { top: 24, left: 47, right: 34, bottom: 0 },
};

const DIRS = ["top", "bottom", "left", "right"] as const;

function cases() {
  return VIEWPORTS.flatMap((vp) => Object.keys(INSETS).map((insets) => ({ viewport: vp.name, insets })));
}

function place(c: { viewport: string; insets: string }) {
  const { width, height } = VIEWPORTS.find((vp) => vp.name === c.viewport)!;
  const insets = INSETS[c.insets];
  return { width, height, insets, scale: cardScale(Math.min(width, height)) };
}

function current(c: { viewport: string; insets: string }) {
  const at = place(c);
  const layout = tableLayout(at);
  return {
    anchors: layout.anchors,
    seatPoints: Object.fromEntries(DIRS.map((d) => [d, layout.seatPoint(d)])),
    floatTop: layout.floatTop,
    chipsBottom: bannerTop(at.width > at.height ? layout : null, at.insets.top),
    tableBox: layout.tableBox,
    pill: layout.pill,
    voteTop: { rest: voteTop(layout.pill, false, at.scale), open: voteTop(layout.pill, true, at.scale) },
  };
}

function today(c: { viewport: string; insets: string }) {
  const { width, height, insets, scale } = place(c);
  const frame = computeTableFrame({ width, height, insets, scale });
  const seats = {
    scale,
    windowWidth: width,
    windowHeight: height,
    tableLeft: frame.tableLeft,
    tableRight: frame.tableRight,
    tableTop: frame.tableTop,
    surplus: frame.surplus,
    bottomPad: frame.bottomPad,
    handCardH: CARD_H(scale * HAND_SCALE),
  };
  const pill = {
    right: width - frame.tableRight - frame.pad,
    top: frame.tableTop,
    restH: CHIP_H(scale),
    centreX: (frame.tableLeft + width - frame.tableRight) / 2,
    unit: (scale * BASE_SHORT_EDGE) / MOCKUP_SHORT_EDGE,
  };
  const openPill = scorePillBox(1, 0, pill);
  return {
    anchors: anchorPoints(tableGeometry(seats)),
    seatPoints: Object.fromEntries(DIRS.map((d) => [d, seatPoint(seats, d)])),
    floatTop: floatTop(seats),
    chipsBottom: notificationTopOffset({ topPad: insets.top, landscape: width > height, scale, surplus: surplusHeight(width, height, scale) / 2 }),
    tableBox: { left: frame.tableLeft, top: frame.tableTop, right: frame.tableRight, bottom: frame.surplus },
    pill,
    voteTop: { rest: pill.top + pill.restH + mockupPx(7, scale), open: openPill.y + openPill.h + mockupPx(7, scale) },
  };
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PIN = JSON.parse(readFileSync(path.join(repoRoot, "tests/fixtures/tableLayout.json"), "utf8")) as {
  case: { viewport: string; insets: string };
  layout: unknown;
}[];

describe("the table lays out where it was pinned", () => {
  test("the pin covers every case, and nothing else", () => {
    assert.deepEqual(
      PIN.map((p) => p.case),
      cases()
    );
  });

  for (const { case: c, layout } of PIN) {
    test(`${c.viewport}, ${c.insets}: today's functions`, () => assert.deepEqual(today(c), layout));
    test(`${c.viewport}, ${c.insets}: tableLayout`, () => assert.deepEqual(current(c), layout));
  }
});
