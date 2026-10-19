import { Motion } from "../tokens.ts";

/** How long every dealt card flies, from the pile to its seat. */
export const DEAL_FLIGHT_MS = Motion.duration.travel;

/**
 * When the `round`-th card leaves the pile, from the deal's start: the viewer's at `slot` null,
 * an opponent's a beat behind by its slot, top, left, right (the lantern mockup's `dealRun`).
 */
export function dealLeaveMs(round: number, slot: number | null): number {
  const lag = slot === null ? 0 : Motion.deal.seat * (slot + 1);
  return Motion.deal.lead + round * Motion.stagger.deal + lag;
}

/** When each of a seat's `count` cards lands at it, `offsetMs` after the deal starts. */
export function dealArrivalsMs(count: number, offsetMs: number, slot: number | null): number[] {
  return Array.from({ length: count }, (_, round) => offsetMs + dealLeaveMs(round, slot) + DEAL_FLIGHT_MS);
}

/** When the deal is done and play may begin, past every landing; the server's exchange floor computes it too. */
export function dealEndMs(counts: readonly number[], offsetMs: number): number {
  if (counts.length === 0) return 0;
  return offsetMs + Motion.deal.lead + Math.max(...counts) * Motion.stagger.deal + Motion.deal.tail;
}
