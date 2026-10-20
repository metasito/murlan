// Which of the table's layers a screen reader loses, and to what.
//
// JSX-free, runtime imports relative — docs/agents/checks.md, "Node's TypeScript loader".

/**
 * - `table`: the game itself, withdrawn by anything that takes the table away.
 * - `sheetOnly`: the overlays slot. The sheet hangs off the rail, outside the slot, so the slot
 *   goes behind its veil; a cover inside the slot does not, or the cover's own message would be
 *   withdrawn with the table it is explaining (`app/(online)/game.tsx` spreads this onto it).
 * - `coverOnly`: the rail. It answers to a cover that paints over it and deliberately not to the
 *   sheet, which is closed by the knob the rail carries: veiling it there shuts a reader inside the
 *   sheet. The opening gate covers it too, or the sheet its knob opens would come up above the
 *   gate carrying an exit.
 * - `clock`: the turn chip. It answers to everything but the opening gate: online the countdown is
 *   the server's and keeps running under the hold, so a reader losing it would be charged for time
 *   it could not hear.
 * - `sheet`: the opening panel. While gated it is the layer holding the table, its gate hidden and
 *   its words on a live region of their own; after that it stays until the first play, and the
 *   sheet opened over it must hide its sentence.
 */
export type VeilRole = "table" | "sheetOnly" | "coverOnly" | "clock" | "sheet";

export function tableVeils(i: {
  settingsOpen: boolean;
  tableCovered: boolean;
  portrait: boolean;
  holdingForStart: boolean;
}): { withdrawn: boolean; veil: Record<VeilRole, boolean> } {
  const covered = i.tableCovered || i.portrait;
  const withdrawn = i.settingsOpen || covered || i.holdingForStart;
  return {
    withdrawn,
    veil: {
      table: withdrawn,
      sheetOnly: i.settingsOpen || i.portrait,
      coverOnly: (covered || i.holdingForStart) && !i.settingsOpen,
      clock: i.settingsOpen || covered,
      sheet: i.settingsOpen,
    },
  };
}
