// The table geometry GameTable.tsx lays out for a window and its safe-area insets, as its own
// `scale`, `frame` and `seatGeometry` derive it. tests/e2e/lampSeats.spec.ts measures the laid-out
// table; where the two disagree, the spec is right and this is stale.
import { CARD_H, HAND_SCALE, cardScale } from "../../components/cardFaceModel.ts";
import { tableGeometry, type SeatPlace, type TableGeometry } from "../../components/flightPhysics.ts";
import { computeTableFrame, type EdgeInsets } from "../../components/tableFrame.ts";

export const NO_INSETS: EdgeInsets = { top: 0, bottom: 0, left: 0, right: 0 };

/** Plan 3 L9: none, a landscape iPhone with its Dynamic Island and home bar, and the island alone. */
export const INSETS: Record<string, EdgeInsets> = {
  "0/0": NO_INSETS,
  "62/21/62": { top: 0, left: 62, bottom: 21, right: 62 },
  "62/0": { top: 0, left: 62, bottom: 0, right: 0 },
};

export function phoneTable(width: number, height: number, insets: EdgeInsets = NO_INSETS): TableGeometry {
  return tableGeometry(phonePlace(width, height, insets));
}

export function phonePlace(width: number, height: number, insets: EdgeInsets = NO_INSETS): SeatPlace {
  const scale = cardScale(Math.min(width, height));
  const frame = computeTableFrame({ width, height, insets, scale });
  return {
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
}
