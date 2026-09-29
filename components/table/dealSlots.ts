import { dealFlightsMs, dealLeaveMs } from "../../lib/game/dealTimeline.ts";
import { seatPoint, type SeatGeometry } from "../flightPhysics.ts";
import { seatDirection } from "../seatLayout.ts";

/** One card's flight from the pile to an opponent's seat, on the deal's clock. */
export interface DealLeg {
  key: string;
  /** When it leaves the pile, in ms after the deal started. */
  leaveMs: number;
  flightMs: number;
  /** Its seat, from the pile — `flightOrigin` for that seat. */
  to: { dx: number; dy: number };
}

/** Each seat's flight time from the pile, by seat index. */
export function dealFlightsFor(geometry: SeatGeometry): number[] {
  const { players, viewerSeat } = geometry;
  return dealFlightsMs(players.map((_, seat) => seatPoint(geometry, seatDirection(seat, viewerSeat, players.length))));
}

/** Every opponent card's leg, round-robin: `counts` and `flightsMs` by seat index. */
export function dealLegs(
  geometry: SeatGeometry,
  deal: { key: number; offsetMs: number; counts: readonly number[]; flightsMs: readonly number[] }
): DealLeg[] {
  return (["top", "left", "right"] as const).flatMap((side) => {
    const o = geometry.opponents[side];
    if (!o) return [];
    const to = seatPoint(geometry, side);
    return Array.from({ length: deal.counts[o.seat] }, (_, round) => ({
      key: `${deal.key}-${o.seat}-${round}`,
      leaveMs: deal.offsetMs + dealLeaveMs(round, o.seat, deal.counts.length),
      flightMs: deal.flightsMs[o.seat],
      to,
    }));
  });
}

/**
 * The legs shared out over views, each view's legs in leaving order: a leg takes the first view
 * whose last leg has landed. Dealt by leaving time, that needs no more views than legs are ever in
 * the air at once.
 */
export function dealSlots(legs: readonly DealLeg[]): DealLeg[][] {
  const slots: DealLeg[][] = [];
  for (const leg of [...legs].sort((a, b) => a.leaveMs - b.leaveMs)) {
    const free = slots.find((slot) => slot[slot.length - 1].leaveMs + slot[slot.length - 1].flightMs <= leg.leaveMs);
    if (free) free.push(leg);
    else slots.push([leg]);
  }
  return slots;
}

/** The leg a view poses at `clockMs`: the last to have left, else its first. */
export function legAt(slot: readonly DealLeg[], clockMs: number): DealLeg {
  "worklet";
  let leg = slot[0];
  for (let i = 1; i < slot.length && slot[i].leaveMs < clockMs; i++) leg = slot[i];
  return leg;
}
