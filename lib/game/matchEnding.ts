// A match's ending on the table (#1267): the score pill opens, counts in, re-ranks and grows
// into the result board over the dimmed table, on the round ending's clock.
//
// Free of runtime `@/` imports, so `node --test` can load it — docs/agents/checks.md,
// "Node's TypeScript loader".
import { MatchEnding as P } from "../tokens.ts";
import { clamp01, easeInOut, easeOut, type EndingSteps } from "./roundEnding.ts";

export const MATCH_STEPS: EndingSteps = P;

export interface MatchOnsets {
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

export function matchEndingOnsets(rows: number): MatchOnsets {
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
export function matchBoard(e: number): number {
  "worklet";
  return easeInOut(clamp01((e - P.board) / P.boardFor));
}

/** The table's dim under the board, 0 to `P.dim`. */
export function matchDim(e: number): number {
  "worklet";
  return e < P.board ? 0 : P.dim * clamp01((e - P.board) / P.dimFor);
}

export function matchWinnerBox(e: number): number {
  "worklet";
  return easeOut(clamp01((e - P.winnerBox) / P.winnerBoxFor));
}

/** The actions' opacity; they take a press only at 1. */
export function matchActions(e: number): number {
  "worklet";
  return easeOut(clamp01((e - P.actions) / P.actionsFor));
}
