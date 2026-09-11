// The constants both game screens are built around, and the scans that keep each
// of them declared in exactly one place. Cross-module by design: pinning a value
// cannot find a second copy holding the same number.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { CARD_H, CARD_W } from "../components/cardFaceModel.ts";
import {
  actionBtnSize,
  HAND_ZONE_GAP,
  CHIP_H,
  SIDE_SECTION_W,
  HAND_CROP,
  HAND_ZONE_H,
  handVisibleH,
  handRowHeadroom,
} from "../components/seatLayout.ts";
import { clientSources, scanSources } from "./helpers/sourceScan.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const scan = (pattern: RegExp) => scanSources(pattern, clientSources(repoRoot));


// A representative resolved card height at scale 1, for tests that need a
// concrete number rather than the function CARD_H now is.
const CH = CARD_H(1);

// Declarations, not uses: `width: CARD_W` and `CARD_W_SMALL` do not match.
const CARD_DIMENSION_DECL = /(?<![\w$])(?:const|let|var)\s+(?:CARD_W|CARD_H)(?![\w$])/g;

// A fan's spread, written out instead of asked for: an `overlap`/`maxAngle`/
// `maxTilt` binding, or the step ternary itself. The ternary is matched on any
// operand name — spelling `cards.length` as `count` is the same copy, and was
// enough to walk past a pattern that only knew the first spelling.
const FAN_CONSTANT_DECL =
  /(?<![\w$])(?:const|let|var)\s+(?:overlap|maxAngle|maxTilt)(?![\w$])|[\w.]+\s*>\s*\d+\s*\?\s*\d+\s*:/g;

// An arc's budget — the radius, ideal step and rise it is solved against.
const ARC_BUDGET_DECL = /(?<![\w$])(?:const|let|var)\s+\w+\s*:\s*ArcBudget(?![\w$])/g;

/** The one file allowed to hold an arc's own shape. */
const ARC_SOURCE = "components/tableArc.ts";

describe("layout constants (pinned here; this test is the authority)", () => {
  test("every constant still holds the value both game screens are built around", () => {
    // These are pinned, not documented: a silent change to any of them breaks
    // the table on one screen or the other with no error signal.
    assert.equal(CARD_W(1), 64);
    assert.equal(CARD_H(1), 90);
    assert.equal(actionBtnSize(1), 56);
    assert.equal(HAND_ZONE_GAP, 26);
    assert.equal(CHIP_H(1), 23);
    assert.equal(SIDE_SECTION_W, 96);
  });

  test("CARD_W/CARD_H scale linearly with the short edge, no breakpoints", () => {
    assert.equal(CARD_W(0.5), CARD_W(1) * 0.5);
    assert.equal(CARD_H(2), CARD_H(1) * 2);
  });

  test("the hand zone keeps headroom for the selection lift, at any card height", () => {
    // The selection lift has to fit inside the zone above the cards, and it is
    // the *same* number: both are `handRowHeadroom` of the card being lifted,
    // so no card size can leave the lift a pixel more than the row reserves.
    for (const h of [CH * 0.7, CH, CH * 1.2]) {
      assert.equal(HAND_ZONE_H(h, 0), handVisibleH(h) + handRowHeadroom(h));
      assert.ok(HAND_ZONE_H(h, 0) - handVisibleH(h) >= handRowHeadroom(h));
    }
  });

  test("the headroom is a share of the card, so a tablet's lift is a tablet's", () => {
    assert.equal(handRowHeadroom(CH * 2), handRowHeadroom(CH) * 2);
    assert.equal(handRowHeadroom(CARD_H(1)), 16);
  });

  test("the hand zone carries the bottom safe pad itself — it runs to the device edge", () => {
    // PASSA and GIOCA sit on the safe line inside it and are never cropped;
    // only the cards run past it.
    assert.equal(HAND_ZONE_H(CH, 21) - HAND_ZONE_H(CH, 0), 21);
  });

  test("only the redundant upside-down index is cropped, never the rank corner", () => {
    // The rank a player reads is at the card's top-left, so a quarter off the
    // foot costs nothing. Half of it would start eating the pip field.
    assert.ok(HAND_CROP > 0 && HAND_CROP <= 0.3);
    assert.equal(handVisibleH(CH), CH * (1 - HAND_CROP));
  });

  // A copy of a constant also holds the pinned value, so the assertions above
  // can never see one. Only the source scan can.
  test("CARD_W and CARD_H are declared in components/cardFaceModel.ts and nowhere else", () => {
    assert.deepEqual(scan(CARD_DIMENSION_DECL), [
      "components/cardFaceModel.ts: const CARD_H",
      "components/cardFaceModel.ts: const CARD_W",
    ]);
  });

  test("nothing writes a fan's spread out any more; every arc asks for a budget", () => {
    assert.deepEqual(scan(FAN_CONSTANT_DECL), []);
  });

  test("only tableArc.ts declares an arc's budget, and it declares exactly three", () => {
    // The hand, the field and a seat's backs. A fourth would be a fourth arc
    // nobody asked for; one declared anywhere else is a copy that goes stale.
    assert.deepEqual(scan(ARC_BUDGET_DECL), [
      `${ARC_SOURCE}: const FIELD_ARC: ArcBudget`,
      `${ARC_SOURCE}: const HAND_ARC: ArcBudget`,
      `${ARC_SOURCE}: const SEAT_ARC: ArcBudget`,
    ]);
  });

  test("the budget scan fires on a budget declared anywhere else", () => {
    // The floor for the two scans above: both now expect a list this file's
    // own sources cannot grow, so a pattern that quietly stopped matching
    // would pass them both.
    const planted: [string, string][] = [
      ["components/table/example.tsx", "const MY_ARC: ArcBudget = { radius: 1, stepRatio: 1, rise: 1 };"],
    ];
    assert.deepEqual(scanSources(ARC_BUDGET_DECL, planted), [
      "components/table/example.tsx: const MY_ARC: ArcBudget",
    ]);
  });

  test("the fan scan fires on every shape a written-out spread takes", () => {
    const planted: [string, string][] = [
      [
        "components/table/example.tsx",
        [
          "const overlap = cards.length > 8 ? 9 : cards.length > 5 ? 12 : 14;",
          "const step = n > 8 ? 9 : n > 5 ? 12 : 14;",
          "const maxAngle = 22;",
          "const { step, angle, totalW } = fanOffsets(n, 'combo');",
        ].join("\n"),
      ],
    ];
    assert.deepEqual(scanSources(FAN_CONSTANT_DECL, planted), [
      "components/table/example.tsx: cards.length > 5 ? 12 :",
      "components/table/example.tsx: cards.length > 8 ? 9 :",
      "components/table/example.tsx: const maxAngle",
      "components/table/example.tsx: const overlap",
      "components/table/example.tsx: n > 5 ? 12 :",
      "components/table/example.tsx: n > 8 ? 9 :",
    ]);
  });

});
