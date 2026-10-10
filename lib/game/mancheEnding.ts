// A manche's ending on the table (#1266): when the score pill opens, counts each gain in,
// re-ranks and closes, and when the next deal comes, all from one clock — the ms since the
// landing that ended the manche, or MANCHE_IDLE with no ending running.
//
// Free of runtime `@/` imports, so `node --test` can load it — docs/agents/checks.md,
// "Node's TypeScript loader".
import { MancheEnding as M } from "../tokens.ts";

export const MANCHE_IDLE = -1;

/** The pill's part of an ending; a partita's never closes (`partitaEnding.ts`). */
export interface EndingSteps {
  open: number;
  openFor: number;
  gain: number;
  gainStep: number;
  popFor: number;
  countFor: number;
  rerank: number;
  rerankFor: number;
  close: number;
  closeFor: number;
  glowFor: number;
}

export const MANCHE_STEPS: EndingSteps = M;

export interface MancheOnsets {
  open: number;
  /** One per row, in finishing order. */
  gains: number[];
  rerank: number;
  close: number;
  /** The pill is closed on the new standings: where a tap or reduced motion jumps to. */
  settled: number;
  pileFade: number;
  deal: number;
  glowEnd: number;
}

export function mancheEndingOnsets(rows: number): MancheOnsets {
  const settled = M.close + M.closeFor;
  return {
    open: M.open,
    gains: Array.from({ length: rows }, (_, i) => M.gain + i * M.gainStep),
    rerank: M.rerank,
    close: M.close,
    settled,
    pileFade: M.deal - M.pileFadeFor,
    deal: M.deal,
    glowEnd: settled + M.glowFor,
  };
}

export function clamp01(k: number): number {
  "worklet";
  return Math.min(1, Math.max(0, k));
}
function backOut(k: number): number {
  "worklet";
  return k <= 0 ? 0 : 1 + 2.70158 * Math.pow(k - 1, 3) + 1.70158 * Math.pow(k - 1, 2);
}
export function easeOut(k: number): number {
  "worklet";
  return 1 - Math.pow(1 - k, 3);
}
export function easeInOut(k: number): number {
  "worklet";
  return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
}

/** How far open the ending holds the pill; back-out overshoots 1. */
export function mancheOpen(e: number, s: EndingSteps): number {
  "worklet";
  if (e < s.open || e >= s.close + s.closeFor) return 0;
  if (e < s.close) return backOut(clamp01((e - s.open) / s.openFor));
  return 1 - easeOut(clamp01((e - s.close) / s.closeFor));
}

/** The row's "+gain", 0 to 1 with a back-out; shown only while the pill is up. */
export function mancheRowPop(e: number, order: number, s: EndingSteps): number {
  "worklet";
  if (e < 0 || e >= s.close + s.closeFor) return 0;
  return backOut(clamp01((e - (s.gain + order * s.gainStep)) / s.popFor));
}

/** How far the row's total has counted from before the manche to after it. */
export function mancheRowCount(e: number, order: number, s: EndingSteps): number {
  "worklet";
  if (e < 0) return 1;
  return easeOut(clamp01((e - (s.gain + order * s.gainStep)) / s.countFor));
}

/** From the order before the manche (0) to the order after it (1). */
export function mancheRerank(e: number, s: EndingSteps): number {
  "worklet";
  if (e < 0) return 1;
  return easeInOut(clamp01((e - s.rerank) / s.rerankFor));
}

/** The held pill's vote, in once the re-rank has played and the pill is still fully open. */
export function mancheVoteShown(e: number): number {
  "worklet";
  const from = M.rerank + M.rerankFor;
  return clamp01((e - from) / (M.close - from));
}

export function mancheGlow(e: number, changed: boolean, s: EndingSteps): number {
  "worklet";
  const settled = s.close + s.closeFor;
  if (!changed || e < settled) return 0;
  return 1 - clamp01((e - settled) / s.glowFor);
}
