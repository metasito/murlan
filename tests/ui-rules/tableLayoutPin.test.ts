// tests/ui-rules/tableLayoutPin.test.ts — tableLayout on every viewport and safe area must land on
// the places pinned in tests/fixtures/tableLayout.json, which the per-caller copies it replaced
// computed (#1684's first commit).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { cardScale } from "../../components/cardFaceModel.ts";
import { voteTop } from "../../components/table/scorePillModel.ts";
import { bannerTop, type EdgeInsets } from "../../components/tableFrame.ts";
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
    test(`${c.viewport}, ${c.insets}`, () => assert.deepEqual(current(c), layout));
  }
});
