import type { DealLeg } from '@/components/table/dealSlots';

export const inAir = (leg: DealLeg, t: number) => leg.leaveMs < t && t < leg.leaveMs + leg.flightMs;

/** The most legs in the air at once, swept between every pair of neighbouring leave and land times. */
export function busiest(legs: readonly DealLeg[]): number {
  const edges = [...new Set(legs.flatMap((l) => [l.leaveMs, l.leaveMs + l.flightMs]))].sort((a, b) => a - b);
  let most = 0;
  for (let i = 1; i < edges.length; i++) {
    const t = (edges[i - 1] + edges[i]) / 2;
    most = Math.max(most, legs.filter((l) => inAir(l, t)).length);
  }
  return most;
}
