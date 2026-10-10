// A partita's ending on the table (#1267): the score pill opens, counts in, re-ranks and grows
// into the result board over the dimmed table, on the manche ending's clock.
//
// Free of runtime `@/` imports, so `node --test` can load it — docs/agents/checks.md,
// "Node's TypeScript loader".
import { PartitaEnding as P } from "../tokens.ts";
import { clamp01, easeInOut, easeOut, type EndingSteps } from "./mancheEnding.ts";

export const PARTITA_STEPS: EndingSteps = P;

export interface PartitaOnsets {
  open: number;
  /** One per row, in finishing order. */
  gains: number[];
  rerank: number;
  board: number;
  winnerBox: number;
  /** The settled board, its actions pressable: where a tap or reduced motion jumps to. */
  actions: number;
  settled: number;
}

export function partitaEndingOnsets(rows: number): PartitaOnsets {
  return {
    open: P.open,
    gains: Array.from({ length: rows }, (_, i) => P.gain + i * P.gainStep),
    rerank: P.rerank,
    board: P.board,
    winnerBox: P.winnerBox,
    actions: P.actions,
    settled: P.actions + P.actionsFor,
  };
}

/** From the open pill (0) to the board (1). */
export function partitaBoard(e: number): number {
  "worklet";
  return easeInOut(clamp01((e - P.board) / P.boardFor));
}

/** The table's dim under the board, 0 to `P.dim`. */
export function partitaDim(e: number): number {
  "worklet";
  return e < P.board ? 0 : P.dim * clamp01((e - P.board) / P.dimFor);
}

export function partitaWinnerBox(e: number): number {
  "worklet";
  return easeOut(clamp01((e - P.winnerBox) / P.winnerBoxFor));
}

/** The actions' opacity; they take a press only at 1. */
export function partitaActions(e: number): number {
  "worklet";
  return easeOut(clamp01((e - P.actions) / P.actionsFor));
}
