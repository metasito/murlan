// The table layout GameTable.tsx builds for a window and its safe-area insets, at the scale it
// takes from the window. tests/e2e/lampSeats.spec.ts measures the laid-out
// table; where the two disagree, the spec is right and this is stale.
import { cardScale } from "../../components/cardFaceModel.ts";
import type { EdgeInsets } from "../../components/tableFrame.ts";
import { tableLayout, type TableLayout } from "../../components/tableLayout.ts";

export const NO_INSETS: EdgeInsets = { top: 0, bottom: 0, left: 0, right: 0 };

/** Plan 3 L9: none, a landscape iPhone with its Dynamic Island and home bar, and the island alone. */
export const INSETS: Record<string, EdgeInsets> = {
  "0/0": NO_INSETS,
  "62/21/62": { top: 0, left: 62, bottom: 21, right: 62 },
  "62/0": { top: 0, left: 62, bottom: 0, right: 0 },
};

export function phoneTable(width: number, height: number, insets: EdgeInsets = NO_INSETS): TableLayout {
  return tableLayout({ width, height, insets, scale: cardScale(Math.min(width, height)) });
}
