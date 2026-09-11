// Screen frame and safe-area maths: what the window leaves the table to use.
//
// This file is deliberately JSX-free, for the same reason components/handLayout.ts
// is: Node's built-in TypeScript loader (`node --test tests/**/*.test.ts`) only
// type-strips plain .ts source — it cannot parse a .tsx file, and it cannot
// resolve the `@/` bundler alias at runtime. A runtime import must therefore be
// relative and carry its .ts extension; `@/` is safe only in a type-only import,
// which is erased before resolution.

import { BASE_SHORT_EDGE } from "./cardFaceModel.ts";
import {
  CHIP_H,
  FIELD_WIDTH_SHARE,
  HAND_WIDTH_SHARE,
  HAND_ZONE_GAP,
  SIDE_SECTION_W,
  actionBtnSize,
} from "./seatLayout.ts";

// ─── The table's own pads ─────────────────────────────────────────────────────
//
// The felt runs edge to edge: there is no frame, and the lamp is what shapes
// it. What the table does keep are its own pads, which scale with it and are
// floored by whatever safe area the device actually reports.

const PAD_TOP = 13;
const PAD_BOTTOM = 13;
/** The edge opposite the rail, whichever physical side that is. */
const PAD_AWAY = 17;
/** From the rail, or the safe edge, to the first thing drawn over the felt. */
const PAD_INNER = 10;

// ─── Table frame ──────────────────────────────────────────────────────────────

export interface EdgeInsets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/**
 * Height the table is given but was not scaled for.
 *
 * `cardScale` caps at `MAX_SHORT_EDGE`, so on a window taller than that the
 * contents are drawn for the cap while the window keeps its own height. Zero
 * everywhere below the cap, which is every phone.
 */
export function surplusHeight(width: number, height: number, scale: number): number {
  // Portrait is not a state the table lays out in, and there the height is the
  // long edge — the subtraction below would read the whole difference between
  // the two edges as surplus.
  if (height > width) return 0;
  return Math.max(0, height - BASE_SHORT_EDGE * scale);
}

export interface ScreenPads {
  topPad: number;
  bottomPad: number;
  leftPad: number;
  rightPad: number;
}

/**
 * Usable screen edges, straight from `useSafeAreaInsets()`. On web that reads
 * the real `env(safe-area-inset-*)` values (react-native-safe-area-context's
 * web polyfill), which requires `viewport-fit=cover` on the viewport meta —
 * see public/index.html — or every side reads 0 regardless of device.
 */
export function computeScreenPads(opts: { insets: EdgeInsets }): ScreenPads {
  return {
    topPad: opts.insets.top,
    bottomPad: opts.insets.bottom,
    leftPad: opts.insets.left,
    rightPad: opts.insets.right,
  };
}

// ─── Control rail ─────────────────────────────────────────────────────────────
//
// A cutout can never sit on a card, but it sits happily between two controls.
// The column the cutout occupies is the rail: menu knob at the top, reactions
// knob at the bottom, cutout in the gap between them.

/**
 * What kind of cutout the device has, from the inset it reports beside it.
 *
 * The three classes do not overlap in what iOS reports — 0-20 with no cutout,
 * 44-50 for a notch, 59-68 for a Dynamic Island — so the inset the app already
 * reads answers the question, and a model-string table (which returns `false`
 * for every phone released after it was written) is not needed.
 * See docs/research/2026-08-26-notch-and-dynamic-island.md.
 */
export type CutoutClass = "none" | "notch" | "island";

const NOTCH_MIN = 30;
const ISLAND_MIN = 55;

export function cutoutClass(inset: number): CutoutClass {
  if (inset >= ISLAND_MIN) return "island";
  if (inset >= NOTCH_MIN) return "notch";
  return "none";
}

/** Air on both sides of a 44pt knob — the width the rail holds with no cutout. */
const RAIL_FLOOR = 58;
/** …and what it grows to on a large screen, before any cutout is considered. */
const RAIL_SCALED = 52;
/** Clearance between the cutout's own edge and the knobs either side of it. */
const RAIL_CUTOUT_CLEARANCE = 12;

/**
 * The rail's width. The floor is what keeps a notchless phone laid out exactly
 * like a notched one: below `RAIL_FLOOR - RAIL_CUTOUT_CLEARANCE` of inset the
 * rail is already wider than the cutout, so the cutout appearing moves nothing.
 */
export function railWidth(insetOnRailSide: number, scale: number): number {
  return Math.max(RAIL_FLOOR, RAIL_SCALED * scale, insetOnRailSide + RAIL_CUTOUT_CLEARANCE);
}

export type RailSide = "left" | "right";

/**
 * `Orientation.LANDSCAPE_LEFT`, as the side the cutout ends up on. Which member
 * means which physical side is unverified — the enum's docs do not say and iOS
 * numbers landscape the opposite way round to its names
 * (docs/research/2026-08-26-notch-and-dynamic-island.md §7.1, measured in #413).
 */
export const LANDSCAPE_LEFT = 3;

export function railSideForOrientation(orientation: number): RailSide {
  return orientation === LANDSCAPE_LEFT ? "left" : "right";
}

/**
 * The edge the rail sits against, from the cutout's own inset and the rotation.
 *
 * A phone with nothing to nest keeps the rail where it is: flipping it would
 * move the menu and reactions knobs to the other hand for no gain, and the rail
 * is already wider than a notch (`RAIL_FLOOR`) so there is nothing to follow.
 */
export function railSideFor(sideInset: number, orientation: number): RailSide {
  if (cutoutClass(sideInset) === "none") return "left";
  return railSideForOrientation(orientation);
}

export interface TableFrame extends ScreenPads {
  /** Width of the control rail, whichever edge it is against. */
  rail: number;
  /** …and which edge that is, so nothing downstream has to work it out again. */
  railSide: RailSide;
  /** From an edge to the first thing drawn over the felt. */
  pad: number;
  tableLeft: number;
  tableTop: number;
  tableRight: number;
  tableBottom: number;
  /**
   * Half of `surplusHeight` — the height at each end of a window taller than
   * the scale cap that the contents were never sized for. It is already inside
   * `tableTop`; anything measuring from the *bottom* edge has to subtract it
   * itself, because the hand deliberately runs past `tableBottom` to the
   * device's own edge and so cannot use that as its floor.
   */
  surplus: number;
  /** Width available to the hand row between the PASSA and GIOCA buttons. */
  handAvailW: number;
  /** …and the share of it the hand aims at — see HAND_WIDTH_SHARE. */
  handRoomW: number;
  /** Width the field's arc may take, bounded by what the side seats leave. */
  fieldRoomW: number;
}

/**
 * The box the table's contents lay out in. Not the felt — the felt is the
 * whole screen — but everything drawn over it: the rail eats the left edge,
 * the chips and the seats sit inside the pads, and the hand runs past the
 * bottom. `tableRight` and `tableBottom` are distances from the right and
 * bottom edges, matching the absolutely-positioned style props they feed.
 */
export function computeTableFrame(opts: {
  width: number;
  /** The window's own height — what the scale cap is measured against. */
  height: number;
  insets: EdgeInsets;
  /** The table's own scale — the rail widens with it. */
  scale: number;
  /**
   * Which edge the cutout is on, and therefore the rail. The table is locked to
   * landscape but not to one landscape *direction*, so this follows the
   * rotation. Resolved here rather than by each caller, because the arithmetic
   * mirrors and doing that twice is how the two halves drift apart.
   */
  railSide?: RailSide;
}): TableFrame {
  const { topPad, bottomPad, leftPad, rightPad } = computeScreenPads(opts);
  const railSide = opts.railSide ?? "left";
  // Past `MAX_SHORT_EDGE` the scale stops growing but the window does not, so
  // there is height the contents were never sized for. It becomes pad at both
  // ends rather than being left to the band between the seats and the hand —
  // stretching one gap is what made a tablet read as a scaled-up phone (#586).
  const surplus = surplusHeight(opts.width, opts.height, opts.scale) / 2;

  // The rail eats the cutout's edge, so the play area starts at its outer edge
  // and everything centred on the table centres on that box rather than on the
  // screen — centring on 50% puts the pile and the top seat ~17px off on an
  // 844pt phone.
  const rail = railWidth(railSide === "left" ? leftPad : rightPad, opts.scale);
  const tableTop = Math.max(PAD_TOP * opts.scale, topPad) + surplus;
  const tableBottom = Math.max(PAD_BOTTOM * opts.scale, bottomPad) + surplus;
  const away = Math.max(PAD_AWAY * opts.scale, railSide === "left" ? rightPad : leftPad);
  const tableLeft = railSide === "left" ? rail : away;
  const tableRight = railSide === "left" ? away : rail;
  const tableW = opts.width - tableLeft - tableRight;
  const handAvailW = tableW - (actionBtnSize(opts.scale) + HAND_ZONE_GAP * opts.scale) * 2;

  return {
    topPad,
    bottomPad,
    leftPad,
    rightPad,
    rail,
    railSide,
    pad: PAD_INNER * opts.scale,
    tableLeft,
    tableTop,
    tableRight,
    tableBottom,
    surplus,
    handAvailW,
    handRoomW: Math.min(handAvailW, opts.width * HAND_WIDTH_SHARE),
    fieldRoomW: Math.min(tableW - SIDE_SECTION_W * 2, opts.width * FIELD_WIDTH_SHARE),
  };
}

/**
 * Top edge the notification banner may start at without covering the table's
 * own chips — which carry the combination on the felt and whose turn it is,
 * exactly the things an AFK or takeover notice is explaining.
 *
 * Landscape is the proxy for "the table is up": it is the only orientation the
 * table runs in, and on a menu screen in landscape the band the banner steps
 * over is empty, so it costs nothing there.
 */
export function notificationTopOffset(opts: {
  topPad: number;
  landscape: boolean;
  /** The table's own scale — the chips are sized from it. */
  scale: number;
  /**
   * `TableFrame.surplus`, which the chips this clears are pushed down by.
   * Required rather than defaulted: it is zero on every phone, so a caller
   * that forgot it would be correct everywhere anyone looked.
   */
  surplus: number;
}): number {
  if (!opts.landscape) return opts.topPad;
  const chipTop = Math.max(PAD_TOP * opts.scale, opts.topPad) + opts.surplus;
  return chipTop + CHIP_H(opts.scale) + PAD_INNER * opts.scale;
}
