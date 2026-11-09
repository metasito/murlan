// Where everything on the table sits, decided once per window: the frame, the seats' points, the
// float, the chip row and HUD, the rail's knobs, the hand zone and its buttons, the table's box and
// the score pill. The table's views are placed from these, and tableRects.ts reads the same.
//
// JSX-free, runtime imports relative — docs/agents/checks.md, "Node's TypeScript loader".

import type { Player } from "@/lib/game/gameEngine";
import { CARD_H, cardScale, chipScale, FIELD_SCALE, HAND_SCALE, physicalTouchTarget } from "./cardFaceModel.ts";
import type { CardFrom } from "./flightPose.ts";
import { actionBtnSize, CHIP_H, HAND_ZONE_ALIGN, HAND_ZONE_H, SEAT_DISC, seatLabelH } from "./seatLayout.ts";
import type { FlyDirection, OpponentArrangement, OpponentSide } from "./seatLayout.ts";
import { aligned, type Align } from "./flexAlign.ts";
import { sideNameInset } from "./table/legibilityRing.ts";
import { pillAnchorFor, type PillAnchor } from "./table/scorePillModel.ts";
import { floatAboveFoot } from "./table/noticeModel.ts";
import { computeTableFrame, SIDE_SEAT_GAP, sideSlotHeight, topBandHeight, type EdgeInsets, type TableFrame } from "./tableFrame.ts";

/** Where the rail holds each knob across its width: `rail`'s slots and `ControlRail` both read it. */
export const RAIL_KNOB_ALIGN: Align = "center";

export interface Point { x: number; y: number }
export interface Rect { x: number; y: number; w: number; h: number }
export interface Delta { dx: number; dy: number }

export interface TableLayout {
  scale: number;
  window: { width: number; height: number };
  frame: TableFrame;
  handCardH: number;
  handZoneH: number;
  /** Each seat's point and the pile's centre, in window points: a ring's centre, or the hand zone's before its lift. */
  anchors: Record<FlyDirection | "pile", Point>;
  /** A seat's point from the pile: where its throw starts, a closed trick is swept, and a dealt card lands. */
  seatPoint(dir: FlyDirection): Delta;
  /** The float slot's top edge: `.floatchip`, above the hand row's floor. */
  floatTop: number;
  /** Bottom edge of the chip row: the banner band's top, and the notification banner's in landscape. */
  chipsBottom: number;
  /** The scale the HUD's chips are drawn at: the table's, or less where the window is too narrow for the row. */
  chips: number;
  /** The combo pill's top-left corner, and the band the turn chip is aligned across. */
  hud: { combo: { left: number; top: number; align: Align }; turn: { left: number; right: number; top: number; align: Align } };
  /** The rail, and the slots of its two knobs. */
  rail: { width: number; menu: Rect; foot: Rect };
  /** The hand zone at its designed place, and the padding its row and buttons stand on. Raised, it sits `handLiftY` higher. */
  handZone: Rect & { padBottom: number };
  /** PASSA and GIOCA, in the hand zone at its designed place. */
  buttons: { passa: Rect; gioca: Rect };
  /** How far each seat's name slides inboard of its disc's outer edge. */
  nameInset: Record<OpponentSide, number>;
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
 * The window's own short edge, never that minus the safe-area insets: the rail absorbs the cutout
 * and the hand zone carries the home indicator, and taking the insets off here instead shrinks the
 * cards on a device only, away from the web table at the same size.
 */
export function tableScale(window: { width: number; height: number }): number {
  return cardScale(Math.min(window.width, window.height));
}

/**
 * The bands are the drawn cap's (`topBandHeight`, `sideSlotHeight`), never a count's, so no seat
 * moves as a hand shrinks. docs/adr/0002-a-play-leaves-the-seat-it-was-thrown-from.md §1.
 */
export function tableLayout(i: { width: number; height: number; insets: EdgeInsets }): TableLayout {
  const { width, height } = i;
  const scale = tableScale(i);
  const frame = computeTableFrame({ ...i, scale });
  const handCardH = CARD_H(scale * HAND_SCALE);
  const handZoneH = HAND_ZONE_H(handCardH, frame.bottomPad);
  const ring = SEAT_DISC * scale;
  const midTop = frame.tableTop + topBandHeight(scale);
  const tableFloor = height - frame.surplus;
  const midH = tableFloor - midTop - handZoneH;
  const tableW = width - frame.tableLeft - frame.tableRight;
  const x = frame.tableLeft + tableW / 2;
  const handZone = { x: frame.tableLeft, y: tableFloor - handZoneH, w: tableW, h: handZoneH, padBottom: frame.bottomPad };
  const btn = actionBtnSize(scale);
  const btnY = aligned(HAND_ZONE_ALIGN, handZone.y, handZone.h - handZone.padBottom, btn);
  const knob = physicalTouchTarget(scale);
  const sideY = midTop + sideSlotHeight(scale) / 2;
  const anchors: Record<FlyDirection | "pile", Point> = {
    pile: { x, y: midTop + midH / 2 },
    top: { x, y: frame.tableTop + seatLabelH(scale) + ring / 2 },
    bottom: { x, y: tableFloor - handZoneH / 2 },
    left: { x: frame.tableLeft + SIDE_SEAT_GAP + ring / 2, y: sideY },
    right: { x: width - frame.tableRight - SIDE_SEAT_GAP - ring / 2, y: sideY },
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
    chipsBottom: frame.tableTop + CHIP_H(scale) + frame.pad,
    chips: chipScale(scale, width),
    hud: {
      combo: { left: frame.tableLeft + frame.pad, top: frame.tableTop, align: "flex-start" },
      turn: { left: frame.tableLeft, right: frame.tableRight, top: frame.tableTop, align: "center" },
    },
    rail: {
      width: frame.rail,
      menu: { x: aligned(RAIL_KNOB_ALIGN, 0, frame.rail, knob), y: frame.tableTop, w: knob, h: knob },
      foot: { x: aligned(RAIL_KNOB_ALIGN, 0, frame.rail, knob), y: height - frame.tableBottom - knob, w: knob, h: knob },
    },
    handZone,
    buttons: {
      passa: { x: frame.tableLeft, y: btnY, w: btn, h: btn },
      gioca: { x: width - frame.tableRight - btn, y: btnY, w: btn, h: btn },
    },
    nameInset: {
      top: 0,
      left: sideNameInset("left", anchors.left.x, ring, width),
      right: sideNameInset("right", anchors.right.x, ring, width),
    },
    tableBox: { left: frame.tableLeft, top: frame.tableTop, right: frame.tableRight, bottom: frame.surplus },
    pill: pillAnchorFor(frame, width, scale),
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
