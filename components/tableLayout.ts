// Where everything on the table sits, decided once per window: the frame, the seats' points, the
// float, the chip row and HUD, the rail's knobs, the hand zone and its buttons, the table's box and
// the score pill. The table's views are placed from these, and tableRects.ts reads the same.
//
// JSX-free, runtime imports relative — docs/agents/checks.md, "Node's TypeScript loader".

import type { Player } from "@/lib/game/gameEngine";
import { CARD_H, chipScale, FIELD_SCALE, HAND_SCALE, physicalTouchTarget, tableScale } from "./cardFaceModel.ts";
import type { CardFrom } from "./flightPose.ts";
import { actionBtnSize, CHIP_H, drawnDisc, HAND_ZONE_ALIGN, HAND_ZONE_H, SIDE_SECTION_W, seatGap, seatLabelH } from "./seatLayout.ts";
import type { FlyDirection, OpponentArrangement, OpponentSide } from "./seatLayout.ts";
import { aligned, type Align } from "./flexAlign.ts";
import { drawnFanBounds } from "./fanGeometry.ts";
import { sideNameInset } from "./table/legibilityRing.ts";
import { pillAnchorFor, scorePillBox, voteTop, type PillAnchor } from "./table/scorePillModel.ts";
import { floatAboveFoot, noticeBox, pileNoteBelowPile } from "./table/noticeModel.ts";
import { computeTableFrame, SIDE_SEAT_GAP, sideSlotHeight, topBandHeight, type EdgeInsets, type TableFrame } from "./tableFrame.ts";

/** Where the rail holds each knob across its width: `rail`'s slots and `ControlRail` both read it. */
export const RAIL_KNOB_ALIGN: Align = "center";

/** The pile's least height: `pile.tsx` draws its area at least this tall, and `pile` is placed at it. */
export const PILE_MIN_H = 80;

export interface Point { x: number; y: number }
export interface Rect { x: number; y: number; w: number; h: number }
export interface Delta { dx: number; dy: number }
type PlacedBox = "topBand" | "midBand" | "seatLeft" | "seatRight" | "pile" | "handZone" | "handWindow" | "passa" | "gioca";
/** Along one axis a box spans its parent between two edges, or stands against its start or end edge at its own size. */
type Span = "stretch" | "start" | "end";
type Placed = { left: number; right: number } | { left: number; width: number } | { right: number; width: number };
type PlacedY = { top: number; bottom: number } | { top: number; height: number } | { bottom: number; height: number };

function placeIn(outer: Rect, inner: Rect, x: Span, y: Span): Placed & PlacedY {
  const left = inner.x - outer.x;
  const top = inner.y - outer.y;
  const right = outer.x + outer.w - (inner.x + inner.w);
  const bottom = outer.y + outer.h - (inner.y + inner.h);
  const across: Placed = x === "stretch" ? { left, right } : x === "start" ? { left, width: inner.w } : { right, width: inner.w };
  const down: PlacedY = y === "stretch" ? { top, bottom } : y === "start" ? { top, height: inner.h } : { bottom, height: inner.h };
  return { ...across, ...down };
}

export interface TableLayout {
  scale: number;
  window: { width: number; height: number };
  frame: TableFrame;
  handCardH: number;
  handZoneH: number;
  /** Each seat's point and the pile's centre, in window points: a ring's centre, or the hand zone's. */
  anchors: Record<FlyDirection | "pile", Point>;
  /** A seat's point from the pile: where its throw starts, a closed trick is swept, and a dealt card lands. */
  seatPoint(dir: FlyDirection): Delta;
  /** The float slot's top edge: `.floatchip`, above the hand row's floor. */
  floatTop: number;
  /** The band a refused play's float stands in beside GIOCA: GIOCA's top as a distance from the window's bottom, and the table's side margins. */
  floatBeside: { giocaTopFromBottom: number; left: number; right: number; mirrored: boolean };
  /** Bottom edge of the chip row: the banner band's top, and the notification banner's in landscape. */
  chipsBottom: number;
  /** The banner band's sides, a pad inside the table's, as distances from the window's edges; its top is `chipsBottom`. */
  bannerBand: { left: number; right: number };
  /** A vote's corner under the score pill: `right` from the window's right edge, `top` from its top, at rest and open. */
  votes: { right: number; top: Record<"rest" | "open", number> };
  /** The middle of the felt the table is drawn on, between the rail and the far margin and inside the surplus. */
  tableCentre: Point;
  /** The scale the HUD's chips are drawn at: the table's, or less where the window is too narrow for the row. */
  chips: number;
  /** The chip row for pills drawn `widths` wide: the combo pill from the left, the score pill at rest on the right, and the turn chip between, a gap clear of both. */
  chipRow(widths: ChipWidths): ChipRow;
  /** The exchange's note, centred under the pile, which is empty while an exchange runs. */
  pileNote: { centreX: number; top: number; h: number; room: number };
  /** The rail, and the slots of its two knobs. */
  rail: { width: number; menu: Rect; foot: Rect };
  /** The band across the table's head, the drawn cap's height: the top seat hangs centred from its top edge. */
  topBand: Rect;
  /** The band between the top band and the hand zone, the table's width: the side seats stand in it and the pile centres in it. */
  midBand: Rect;
  /** Each side seat's slot at the middle band's top, inside the seat's gap from the table's edge: the seat centres in it down the band and stands against its outer side. */
  seatSlots: Record<"left" | "right", Rect>;
  /** The middle band between the side seats' columns: the pile and every moment drawn over it centre in it. */
  pileBand: Rect;
  /**
   * The pile's box: the pile band's width at `PILE_MIN_H`, centred on the pile's anchor, and a
   * taller pile overflows it evenly. Not the band's height: a box reaching the hand, which rises
   * into the band, takes the hand into the pile's compositing layer and moves its antialiasing.
   */
  pile: Rect;
  /** The hand zone at its designed place; its row and buttons stand on `frame.bottomPad`. */
  handZone: Rect;
  /** The span the hand row is drawn in between PASSA and GIOCA, centred on the hand zone, over its padding: a row wider than it scrolls under it. */
  handWindow: Rect;
  /**
   * The absolute boxes in their parents: the bands and the hand zone in the table box, the seat
   * slots and the pile in the middle band, the hand window and the buttons in the hand zone.
   * The browser rounds each length to a layout unit, so a box spanning its parent takes both edges
   * and a box of its own size takes that size and the one edge it stands against: any other form
   * lands a layout unit off and moves every glyph inside by it.
   */
  placed: Record<PlacedBox, Placed & PlacedY>;
  /** PASSA and GIOCA, in the hand zone at its designed place: GIOCA on the right, or on the left under `playOnLeft`. */
  buttons: { passa: Rect; gioca: Rect };
  /** How far each seat's name slides inboard of its disc's outer edge. */
  nameInset: Record<OpponentSide, number>;
  /** How wide a badge may run from each seat: a side seat's stops a gap short of the top fan, which its row meets on a wide table. */
  badgeRoom: Record<OpponentSide, number>;
  /**
   * The table overlay's box, as distances from each window edge. Its bottom is the table's own
   * edge, not the felt's: the hand runs to it and past it, which is what buys the table the height
   * above. `surplus` is zero on every phone, and taken off both ends of a window taller than the
   * scale cap so the drawn table stays centred rather than growing one gap.
   */
  tableBox: { left: number; top: number; right: number; bottom: number };
  pill: PillAnchor;
}

/**
 * The bands are the drawn cap's (`topBandHeight`, `sideSlotHeight`), never a count's, so no seat
 * moves as a hand shrinks. docs/adr/0002-a-play-leaves-the-seat-it-was-thrown-from.md §1.
 */
export function tableLayout(i: { width: number; height: number; insets: EdgeInsets; playOnLeft?: boolean }): TableLayout {
  const { width, height, playOnLeft = false } = i;
  const scale = tableScale(i);
  const frame = computeTableFrame({ ...i, scale });
  const handCardH = CARD_H(scale * HAND_SCALE);
  const handZoneH = HAND_ZONE_H(handCardH, frame.bottomPad);
  const ring = drawnDisc(scale);
  const topH = topBandHeight(scale);
  const midTop = frame.tableTop + topH;
  const tableFloor = height - frame.surplus;
  const midH = tableFloor - midTop - handZoneH;
  const tableW = width - frame.tableLeft - frame.tableRight;
  const x = frame.tableLeft + tableW / 2;
  const handZone = { x: frame.tableLeft, y: tableFloor - handZoneH, w: tableW, h: handZoneH };
  const topBand = { x: frame.tableLeft, y: frame.tableTop, w: tableW, h: topH };
  const midBand = { x: frame.tableLeft, y: midTop, w: tableW, h: midH };
  const slotW = SIDE_SECTION_W - 2 * SIDE_SEAT_GAP;
  const seatSlots = {
    left: { x: frame.tableLeft + SIDE_SEAT_GAP, y: midTop, w: slotW, h: sideSlotHeight(scale) },
    right: { x: width - frame.tableRight - SIDE_SECTION_W + SIDE_SEAT_GAP, y: midTop, w: slotW, h: sideSlotHeight(scale) },
  };
  const pileBand = { x: frame.tableLeft + SIDE_SECTION_W, y: midTop, w: tableW - 2 * SIDE_SECTION_W, h: midH };
  const handWindow = { x: x - frame.handAvailW / 2, y: handZone.y, w: frame.handAvailW, h: handZone.h - frame.bottomPad };
  const tableBox = { left: frame.tableLeft, top: frame.tableTop, right: frame.tableRight, bottom: frame.surplus };
  const table = { x: tableBox.left, y: tableBox.top, w: width - tableBox.left - tableBox.right, h: height - tableBox.top - tableBox.bottom };
  const btn = actionBtnSize(scale);
  const btnY = aligned(HAND_ZONE_ALIGN, handZone.y, handZone.h - frame.bottomPad, btn);
  const knob = physicalTouchTarget(scale);
  const chips = chipScale(scale, width);
  const pill = pillAnchorFor(frame, width, scale);
  const chipsBottom = frame.tableTop + CHIP_H(scale) + frame.pad;
  const leftBtn = { x: frame.tableLeft, y: btnY, w: btn, h: btn };
  const rightBtn = { x: width - frame.tableRight - btn, y: btnY, w: btn, h: btn };
  const [passa, gioca] = playOnLeft ? [rightBtn, leftBtn] : [leftBtn, rightBtn];
  const [passaSide, giocaSide]: Span[] = playOnLeft ? ["end", "start"] : ["start", "end"];
  const sideY = seatSlots.left.y + seatSlots.left.h / 2;
  const anchors: Record<FlyDirection | "pile", Point> = {
    pile: { x, y: midTop + midH / 2 },
    top: { x, y: frame.tableTop + seatLabelH(scale) + ring / 2 },
    bottom: { x, y: tableFloor - handZoneH / 2 },
    left: { x: seatSlots.left.x + ring / 2, y: sideY },
    right: { x: seatSlots.right.x + seatSlots.right.w - ring / 2, y: sideY },
  };
  const pile = { x: pileBand.x, y: anchors.pile.y - PILE_MIN_H / 2, w: pileBand.w, h: PILE_MIN_H };
  const nameInset = {
    top: 0,
    left: sideNameInset("left", anchors.left.x, ring, width),
    right: sideNameInset("right", anchors.right.x, ring, width),
  };
  const topW = drawnFanBounds(scale).topW;
  const [fanLeft, fanRight] = [anchors.top.x - topW / 2, anchors.top.x + topW / 2];
  const badgeRoom = {
    top: Infinity,
    left: fanLeft - seatGap(scale) - (anchors.left.x - ring / 2 + nameInset.left),
    right: anchors.right.x + ring / 2 - nameInset.right - (fanRight + seatGap(scale)),
  };
  return {
    scale,
    window: { width, height },
    frame,
    handCardH,
    handZoneH,
    anchors,
    seatPoint: (dir) => ({ dx: anchors[dir].x - anchors.pile.x, dy: anchors[dir].y - anchors.pile.y }),
    floatTop: tableFloor - frame.bottomPad - floatAboveFoot(scale),
    floatBeside: { giocaTopFromBottom: height - gioca.y, left: frame.tableLeft, right: frame.tableRight, mirrored: playOnLeft },
    chipsBottom,
    bannerBand: { left: frame.tableLeft + frame.pad, right: frame.tableRight + frame.pad },
    votes: { right: width - pill.right, top: { rest: voteTop(pill, false, scale), open: voteTop(pill, true, scale) } },
    tableCentre: { x: (frame.tableLeft + width - frame.tableRight) / 2, y: (frame.tableTop + height - frame.surplus) / 2 },
    chips,
    chipRow: (widths) => chipRow(frame, pill, widths),
    pileNote: pileNote(x, anchors.pile.y, scale, frame.fieldRoomW),
    rail: {
      width: frame.rail,
      menu: { x: aligned(RAIL_KNOB_ALIGN, 0, frame.rail, knob), y: frame.tableTop, w: knob, h: knob },
      foot: { x: aligned(RAIL_KNOB_ALIGN, 0, frame.rail, knob), y: height - frame.tableBottom - knob, w: knob, h: knob },
    },
    topBand,
    midBand,
    seatSlots,
    pileBand,
    pile,
    handZone,
    handWindow,
    placed: {
      topBand: placeIn(table, topBand, "stretch", "start"),
      midBand: placeIn(table, midBand, "stretch", "stretch"),
      seatLeft: placeIn(midBand, seatSlots.left, "start", "start"),
      seatRight: placeIn(midBand, seatSlots.right, "end", "start"),
      pile: placeIn(midBand, pile, "stretch", "start"),
      handZone: placeIn(table, handZone, "stretch", "stretch"),
      handWindow: placeIn(handZone, handWindow, "stretch", "stretch"),
      passa: placeIn(handZone, passa, passaSide, "end"),
      gioca: placeIn(handZone, gioca, giocaSide, "end"),
    },
    buttons: { passa, gioca },
    nameInset,
    badgeRoom,
    tableBox,
    pill,
  };
}

function pileNote(centreX: number, pileY: number, scale: number, room: number): TableLayout["pileNote"] {
  const h = noticeBox("pileNote", scale).height ?? 0;
  return { centreX, top: pileY + pileNoteBelowPile(scale) - h / 2, h, room };
}

/** What the chip row's two pills measure as drawn: the widths they come to inside the rooms `chipRow` gave them. */
export interface ChipWidths { combo: number; turn: number }

interface ChipRow {
  /** Its room is the whole row left of the score pill: the combo pill is never cut for the turn chip. */
  combo: { left: number; top: number; room: number };
  /** Its room is the band between the combo pill, as wide as it is, and the score pill; its `left` centres it on the felt, or keeps it a gap clear of its neighbours. `centred` is the span, symmetric about the felt's centre line, that a chip no wider than it is centred in by alignment, so its place needs no measure; null where it is clamped. */
  turn: { left: number; top: number; room: number; w: number; centred: { left: number; width: number } | null };
}

function chipRow(frame: TableFrame, pill: PillAnchor, widths: ChipWidths): ChipRow {
  const comboLeft = frame.tableLeft + frame.pad;
  const bandRight = scorePillBox(0, 0, pill).x - frame.pad;
  const comboW = Math.min(widths.combo, bandRight - comboLeft);
  const bandLeft = comboLeft + comboW + frame.pad;
  const turnW = Math.min(widths.turn, bandRight - bandLeft);
  const left = Math.min(Math.max(pill.centreX - turnW / 2, bandLeft), bandRight - turnW);
  const half = Math.min(pill.centreX - bandLeft, bandRight - pill.centreX);
  const centred = turnW <= 2 * half ? { left: pill.centreX - half, width: 2 * half } : null;
  return {
    combo: { left: comboLeft, top: frame.tableTop, room: bandRight - comboLeft },
    turn: { left, top: frame.tableTop, room: bandRight - bandLeft, w: turnW, centred },
  };
}

export interface Seating {
  viewerSeat: number;
  players: readonly Player[];
  opponents: OpponentArrangement<Player>;
}

/** A hand card's starting pose from the pile: its drawn slot if the hand reported one, else the seat's point at hand scale. */
export function ownSlotFrom(origin: Delta, own: CardFrom | undefined): CardFrom {
  return own
    ? { ...own, x: own.x + origin.dx, y: own.y + origin.dy }
    : { x: origin.dx, y: origin.dy, rot: 0, scale: HAND_SCALE / FIELD_SCALE };
}
