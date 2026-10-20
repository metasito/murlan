// Where everything on the table sits, decided once per window: the frame, the seats' points, the
// float, the chip row, the table's box and the score pill.
//
// JSX-free, runtime imports relative — docs/agents/checks.md, "Node's TypeScript loader".

import type { Player } from "@/lib/game/gameEngine";
import { Spacing } from "../lib/tokens.ts";
import { CARD_H, FIELD_SCALE, HAND_SCALE } from "./cardFaceModel.ts";
import type { CardFrom } from "./flightPose.ts";
import { CHIP_H, HAND_ZONE_H, SEAT_DISC, seatLabelH } from "./seatLayout.ts";
import type { FlyDirection, OpponentArrangement } from "./seatLayout.ts";
import { pillAnchorFor, type PillAnchor } from "./table/scorePillModel.ts";
import { floatAboveFoot } from "./table/noticeModel.ts";
import { computeTableFrame, sideSlotHeight, topBandHeight, type EdgeInsets, type TableFrame } from "./tableFrame.ts";

export interface Point { x: number; y: number }
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
export function tableLayout(i: { width: number; height: number; insets: EdgeInsets; scale: number }): TableLayout {
  const { width, height, scale } = i;
  const frame = computeTableFrame(i);
  const handCardH = CARD_H(scale * HAND_SCALE);
  const handZoneH = HAND_ZONE_H(handCardH, frame.bottomPad);
  const ring = SEAT_DISC * scale;
  const midTop = frame.tableTop + topBandHeight(scale);
  const tableFloor = height - frame.surplus;
  const midH = tableFloor - midTop - handZoneH;
  const x = frame.tableLeft + (width - frame.tableLeft - frame.tableRight) / 2;
  const sideY = midTop + sideSlotHeight(scale) / 2;
  const anchors: Record<FlyDirection | "pile", Point> = {
    pile: { x, y: midTop + midH / 2 },
    top: { x, y: frame.tableTop + seatLabelH(scale) + ring / 2 },
    bottom: { x, y: tableFloor - handZoneH / 2 },
    left: { x: frame.tableLeft + Spacing.sm + ring / 2, y: sideY },
    right: { x: width - frame.tableRight - Spacing.sm - ring / 2, y: sideY },
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
