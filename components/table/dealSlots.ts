import { DEAL_FLIGHT_MS, dealLeaveMs } from "../../lib/game/dealTimeline.ts";
import { FAN_TURN } from "../fanGeometry.ts";
import { seatPoint, type SeatGeometry } from "../flightPhysics.ts";
import { seatDirection } from "../seatLayout.ts";

/** One card's flight from the pile to an opponent's seat, on the deal's clock. */
export interface DealLeg {
  key: string;
  /** When it leaves the pile, in ms after the deal started. */
  leaveMs: number;
  flightMs: number;
  /** Its seat, from the pile — `flightOrigin` for that seat — and its fan's turn. */
  to: { dx: number; dy: number; rot: number };
}

const SLOTS = ["top", "left", "right"] as const;

/** A seat's place in the deal's order behind the viewer: null for the viewer. */
export function dealSlotOf(seat: number, viewerSeat: number, players: number): number | null {
  const dir = seatDirection(seat, viewerSeat, players);
  return dir === "bottom" ? null : SLOTS.indexOf(dir);
}

/** Every opponent card's leg, round-robin: `counts` by seat index. */
export function dealLegs(geometry: SeatGeometry, deal: { key: number; offsetMs: number; counts: readonly number[] }): DealLeg[] {
  return SLOTS.flatMap((side, slot) => {
    const o = geometry.opponents[side];
    if (!o) return [];
    const to = { ...seatPoint(geometry, side), rot: FAN_TURN[side] };
    return Array.from({ length: deal.counts[o.seat] }, (_, round) => ({
      key: `${deal.key}-${o.seat}-${round}`,
      leaveMs: deal.offsetMs + dealLeaveMs(round, slot),
      flightMs: DEAL_FLIGHT_MS,
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
