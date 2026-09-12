// The frame the table is drawn inside: the rail, the cutout, and the pads they leave.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { TOUCH_TARGET_MIN } from "../lib/tokens.ts";
import {
  actionBtnSize,
  HAND_ZONE_GAP,
  CHIP_H,
  SIDE_SECTION_W,
  HAND_WIDTH_SHARE,
} from "../components/seatLayout.ts";
import {
  notificationTopOffset,
  computeTableFrame,
  railWidth,
  cutoutClass,
  railSideForOrientation,
  railSideFor,
  LANDSCAPE_LEFT,
} from "../components/tableFrame.ts";
import { clientSources, scanSources } from "./helpers/sourceScan.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const scan = (pattern: RegExp) => scanSources(pattern, clientSources(repoRoot));

describe("notificationTopOffset", () => {
  // The HUD chips sit at the head of the felt and carry whose turn it is, the
  // countdown and the hand count — the very things an AFK or seat-takeover
  // notice is explaining, so the banner starts below them.
  const topPad = 47;

  test("in landscape the banner starts below the HUD chips", () => {
    const top = notificationTopOffset({ topPad, landscape: true, scale: 1, surplus: 0 });
    assert.ok(top >= topPad + CHIP_H(1), `${top} still overlaps the chips`);
  });

  test("portrait — every menu screen — is left exactly where it was", () => {
    assert.equal(notificationTopOffset({ topPad, landscape: false, scale: 1, surplus: 0 }), topPad);
  });

  test("a zero inset still clears the chips in landscape", () => {
    assert.ok(notificationTopOffset({ topPad: 0, landscape: true, scale: 1, surplus: 0 }) >= CHIP_H(1));
  });

  // The chips this clears are inside the table's frame, and on a window past
  // the scale cap that frame starts `surplus` lower than the safe pad does.
  test("a surplus moves the chips down, and the banner with them", () => {
    const flush = notificationTopOffset({ topPad, landscape: true, scale: 1, surplus: 0 });
    const inset = notificationTopOffset({ topPad, landscape: true, scale: 1, surplus: 62 });
    assert.equal(inset - flush, 62);
  });

  test("scales with the table, so a tablet's banner clears a tablet's chips", () => {
    const one = notificationTopOffset({ topPad, landscape: true, scale: 1, surplus: 0 });
    const two = notificationTopOffset({ topPad, landscape: true, scale: 2, surplus: 0 });
    assert.ok(two > one, `${two} is no lower than ${one}`);
    assert.ok(two >= topPad + CHIP_H(2), `${two} still overlaps a tablet's chips`);
  });
});


describe("railWidth", () => {
  test("holds a 44pt knob with air on both sides when there is no cutout at all", () => {
    assert.ok(railWidth(0, 1) >= TOUCH_TARGET_MIN + 12);
  });

  test("a cutout narrower than the floor moves nothing", () => {
    // An iPhone X..14's 44pt landscape inset still fits under the floor, so a
    // notched phone and a notchless one lay out identically.
    assert.equal(railWidth(44, 1), railWidth(0, 1));
  });

  test("a Dynamic Island's inset widens the rail past its floor, plus clearance", () => {
    assert.equal(railWidth(59, 1), 59 + 12);
    assert.ok(railWidth(59, 1) > railWidth(0, 1));
  });

  test("grows with the table's scale, so it is never a fixed column on a tablet", () => {
    assert.ok(railWidth(0, 2) > railWidth(0, 1));
  });
});

describe("the rail's vertical pad", () => {
  // railWidth already floors the horizontal axis against a raw inset; the
  // knobs at the rail's own top and bottom need the same floor every other
  // element pinned to an edge gets (tableTop/tableBottom), or a device with
  // insets.top === 0 (an iPhone in landscape) flushes a knob against the
  // screen edge.
  test("the control rail and its settings sheet take the floored pad, not the raw inset", () => {
    assert.deepEqual(scan(/(?:top|bottom)Pad=\{frame\.(?:topPad|bottomPad)\}/g), []);
  });

  // Banning the raw spelling is half the pin: it also passes when the props are
  // gone entirely, or spelled some third way. Both ends of both must be found.
  test("both ends of both are pinned to the floored pad", () => {
    assert.equal(scan(/topPad=\{frame\.tableTop\}/g).length, 2);
    assert.equal(scan(/bottomPad=\{frame\.tableBottom\}/g).length, 2);
  });
});

describe("computeTableFrame", () => {
  const insets = { top: 20, bottom: 10, left: 44, right: 44 };
  const frameOf = (over: Partial<{ width: number; insets: typeof insets; scale: number }> = {}) =>
    computeTableFrame({ width: 800, height: 390, insets, scale: 1, ...over });

  // The felt itself is edge to edge; the frame is where things are *drawn* on
  // it. Each edge is the safe-area inset or the table's own padding, whichever
  // is further in — a device with no cutout still keeps the chrome off the rim.
  test("each edge clears both the safe area and the table's own padding", () => {
    const f = frameOf();
    assert.equal(f.tableTop, 20);
    assert.equal(f.tableRight, 44);
    assert.equal(f.tableBottom, 13);
    assert.ok(f.pad > 0, "nothing separates the chrome from the table's edge");
  });

  test("a screen with no insets at all still keeps the chrome off the rim", () => {
    const f = frameOf({ insets: { top: 0, bottom: 0, left: 0, right: 0 } });
    assert.ok(f.tableTop > 0, "the chrome starts at the very top of the screen");
    assert.ok(f.tableRight > 0, "the chrome runs to the very right of the screen");
    assert.ok(f.tableBottom > 0, "the hand sits on the bottom edge of the screen");
  });

  test("the play area starts at the rail's outer edge, not at the safe-area inset", () => {
    const f = frameOf();
    assert.equal(f.rail, railWidth(insets.left, 1));
    assert.equal(f.tableLeft, f.rail);
  });

  test("the play area's centre is the box's own centre, so flex centring is honest", () => {
    // (rail + width - safeRight) / 2 — centring on 50% of the screen would put
    // the pile and the top seat ~17px off on an 844pt phone.
    const f = frameOf({ width: 844 });
    const boxCentre = f.tableLeft + (844 - f.tableLeft - f.tableRight) / 2;
    assert.equal(boxCentre, (f.rail + 844 - f.tableRight) / 2);
  });

  test("web reads the same real insets as native — no fixed fallback pads", () => {
    const f = frameOf();
    assert.equal(f.topPad, insets.top);
    assert.equal(f.bottomPad, insets.bottom);
    assert.equal(f.leftPad, insets.left);
    assert.equal(f.rightPad, insets.right);
  });

  test("the hand gets what the two buttons and their gaps leave", () => {
    const f = frameOf();
    const tableW = 800 - f.tableLeft - f.tableRight;
    assert.equal(f.handAvailW, tableW - (actionBtnSize(1) + HAND_ZONE_GAP) * 2);
  });

  test("the hand row leaves room for both side buttons", () => {
    const f = frameOf();
    assert.ok(f.handAvailW > 0);
    assert.ok(f.handAvailW < 800 - actionBtnSize(1) * 2);
  });

  // A button that shrinks below a thumb on a small phone is a button that gets
  // mis-tapped; a button frozen at 56 on a tablet is a button that shrinks.
  test("the buttons scale up with the table but never below a thumb", () => {
    assert.ok(actionBtnSize(2) > actionBtnSize(1));
    assert.equal(actionBtnSize(0.1), 48);
  });

  test("the hand aims at its share of the width and never stretches past it", () => {
    const f = frameOf({ width: 844 });
    assert.equal(f.handRoomW, 844 * HAND_WIDTH_SHARE);
    // The floor: on this device the share is the tighter of the two, which is
    // the whole point — otherwise the hand would spread across the felt.
    assert.ok(f.handRoomW < f.handAvailW);
  });

  test("a narrow screen falls back to what the row actually has", () => {
    // On a small phone the buttons leave less than the share asks for, and
    // the row cannot be given width that is not there.
    const f = frameOf({ width: 480 });
    assert.equal(f.handRoomW, Math.min(f.handAvailW, 480 * HAND_WIDTH_SHARE));
    assert.ok(f.handRoomW <= f.handAvailW);
  });

  test("the field takes what the seats leave it, capped by its own share", () => {
    const f = frameOf({ width: 844 });
    const tableW = 844 - f.tableLeft - f.tableRight;
    assert.equal(f.fieldRoomW, Math.min(tableW - SIDE_SECTION_W * 2, 844 * 0.55));
    assert.ok(f.fieldRoomW > 0);
    // Neither arc may take the whole table: together they still leave the
    // seats their columns.
    assert.ok(f.fieldRoomW < tableW);
    assert.ok(f.handRoomW < 844);
  });

  // Numbers, not the formula again: restating `min(tableW - 2*SIDE_SECTION_W,
  // share)` passes whatever either term holds, which is how a column twice the
  // prototype's width sat here unnoticed. The small phone is where the seats'
  // own columns bind rather than the share.
  test("the seats' columns are what caps the field on the smallest phone", () => {
    const noInsets = { top: 0, bottom: 0, left: 0, right: 0 };
    const small = computeTableFrame({ width: 568, height: 320, insets: noInsets, scale: 320 / 390 });
    const tableW = 568 - small.tableLeft - small.tableRight;
    assert.equal(Math.round(tableW - SIDE_SECTION_W * 2), 304);
    assert.ok(
      tableW - SIDE_SECTION_W * 2 < 568 * 0.55,
      "the share is meant to be the looser of the two bounds here"
    );
    assert.equal(Math.round(small.fieldRoomW), 304);
  });

});


describe("cutoutClass", () => {
  // The three classes do not overlap in what iOS reports, so one inset answers
  // the question and no device table is needed (docs/research/
  // 2026-08-26-notch-and-dynamic-island.md).
  test("names each of the three device classes from its reported inset", () => {
    for (const [inset, expected] of [
      [0, "none"], [20, "none"], [44, "notch"], [50, "notch"], [59, "island"], [68, "island"],
    ] as const) {
      assert.equal(cutoutClass(inset), expected, `an inset of ${inset} is a ${expected} cutout`);
    }
  });

  // The boundaries are the whole of this function: a threshold that drifts by a
  // point reclassifies a real phone, and nothing else would notice.
  test("the boundaries fall between the reported ranges, not inside one", () => {
    for (const [inset, expected] of [
      [29, "none"], [30, "notch"], [54, "notch"], [55, "island"],
    ] as const) {
      assert.equal(cutoutClass(inset), expected, `the boundary moved: ${inset} read as ${cutoutClass(inset)}`);
    }
  });

  test("a value below zero or absurdly large still answers", () => {
    assert.equal(cutoutClass(-1), "none");
    assert.equal(cutoutClass(200), "island");
  });
});

describe("computeTableFrame, mirrored", () => {
  const insets = { top: 20, bottom: 10, left: 59, right: 59 };
  const frameOf = (railSide: "left" | "right") =>
    computeTableFrame({ width: 800, height: 390, insets, scale: 1, railSide });

  // The point of the ticket: rotate the phone and the cutout moves to the other
  // side, so the rail has to follow it. Everything about the frame is the same
  // shape either way — only the edges swap.
  test("the right-hand frame is the left-hand one with its edges swapped", () => {
    const l = frameOf("left");
    const r = frameOf("right");

    assert.equal(r.rail, l.rail, "the rail changed width when it changed sides");
    assert.equal(r.tableRight, l.tableLeft, "the rail is not against the right edge");
    assert.equal(r.tableLeft, l.tableRight, "the play area does not start where the rail is not");
  });

  test("the play area is the same width whichever side the rail is on", () => {
    const l = frameOf("left");
    const r = frameOf("right");
    assert.equal(800 - r.tableLeft - r.tableRight, 800 - l.tableLeft - l.tableRight);
    assert.equal(r.handAvailW, l.handAvailW);
    assert.equal(r.fieldRoomW, l.fieldRoomW);
  });

  // The defect this replaces: the rail was grown from `insets.left` whatever the
  // rotation, so in the rotation with the Island on the right the app reserved
  // the cutout's width twice — once as a rail nothing sits behind, once as
  // right-edge padding — and the cutout sat over the padding rather than
  // between the two knobs.
  test("the rail is grown from the inset on its own side", () => {
    const lopsided = { top: 20, bottom: 10, left: 0, right: 59 };
    const r = computeTableFrame({ width: 800, height: 390, insets: lopsided, scale: 1, railSide: "right" });
    assert.equal(r.rail, railWidth(59, 1), "a right-hand rail was grown from the left inset");

    const l = computeTableFrame({ width: 800, height: 390, insets: lopsided, scale: 1, railSide: "left" });
    assert.equal(l.rail, railWidth(0, 1), "a left-hand rail was grown from the right inset");
  });

  test("the play area's centre is the box's own centre on either side", () => {
    for (const side of ["left", "right"] as const) {
      const f = computeTableFrame({ width: 844, height: 390, insets, scale: 1, railSide: side });
      const boxCentre = f.tableLeft + (844 - f.tableLeft - f.tableRight) / 2;
      assert.equal(boxCentre, (f.tableLeft + 844 - f.tableRight) / 2, side);
    }
  });

  test("a frame asked for no side at all still puts the rail on the left", () => {
    const f = computeTableFrame({ width: 800, height: 390, insets, scale: 1 });
    assert.equal(f.tableLeft, f.rail);
  });
});

describe("railSideForOrientation", () => {
  // The table locks to landscape but not to one landscape direction, so the
  // rail's side is a function of the rotation and of nothing else.
  test("the two landscape rotations put the rail on opposite sides", () => {
    assert.equal(railSideForOrientation(LANDSCAPE_LEFT), "left", "the named rotation lost its side");
    assert.notEqual(
      railSideForOrientation(LANDSCAPE_LEFT + 1),
      "left",
      "both rotations put the rail on the same side, so it never follows the cutout"
    );
  });

  // Portrait and unknown reach this only in the moment before the lock takes,
  // and either side is wrong then; what must not happen is a crash or an
  // undefined that reaches a style.
  test("every other value still answers with a side", () => {
    for (const o of [0, 1, 2, 99]) {
      assert.ok(["left", "right"].includes(railSideForOrientation(o)), String(o));
    }
  });
});

describe("railSideFor", () => {
  const OTHER = LANDSCAPE_LEFT + 1;

  // The knobs only change hands when there is something to follow. A notchless
  // phone flipping would move them for no gain, and the rail already clears a
  // notch without growing, so only an island moves anything.
  test("a phone with no cutout keeps the rail where it was", () => {
    assert.equal(railSideFor(0, LANDSCAPE_LEFT), "left");
    assert.equal(railSideFor(0, OTHER), "left", "a notchless phone moved its knobs on rotation");
    assert.equal(railSideFor(20, OTHER), "left", "a notchless phone moved its knobs on rotation");
  });

  test("a phone with a cutout follows the rotation", () => {
    for (const inset of [44, 59, 68]) {
      assert.notEqual(
        railSideFor(inset, LANDSCAPE_LEFT),
        railSideFor(inset, OTHER),
        `an inset of ${inset} put the rail on the same side in both rotations`
      );
    }
  });
});
