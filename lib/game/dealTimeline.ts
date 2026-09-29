import { Motion } from "../tokens.ts";

/** How long a dealt card takes from the pile to the farthest seat. */
export const DEAL_FLIGHT_MS = Motion.duration.travel;

/**
 * Each seat's flight time from the pile, given where each seat sits from it:
 * every card flies at one speed, the one that carries it to the farthest seat
 * in `DEAL_FLIGHT_MS`, so a nearer seat is dealt to sooner.
 */
export function dealFlightsMs(seats: readonly { dx: number; dy: number }[]): number[] {
  const distances = seats.map(({ dx, dy }) => Math.hypot(dx, dy));
  const reach = Math.max(0, ...distances);
  return distances.map((d) => (reach > 0 ? (DEAL_FLIGHT_MS * d) / reach : DEAL_FLIGHT_MS));
}

/**
 * When the `round`-th card leaves the pile for `seat`, from the deal's start:
 * round-robin in seat order, as `dealCards` deals, with each seat's own cards
 * `Motion.stagger.deal` apart — the spacing the viewer's hand deals at.
 */
export function dealLeaveMs(round: number, seat: number, seats: number): number {
  return round * Motion.stagger.deal + (seat * Motion.stagger.deal) / seats;
}

/** When each of a seat's `count` cards lands at it, `offsetMs` after the deal starts. */
export function dealArrivalsMs(
  count: number,
  seat: number,
  seats: number,
  offsetMs: number,
  flightMs: number
): number[] {
  return Array.from({ length: count }, (_, round) => offsetMs + dealLeaveMs(round, seat, seats) + flightMs);
}

/** The deal's last landing, at any seat; the server's exchange floor computes it too. */
export function dealEndMs(counts: readonly number[], offsetMs: number, flightsMs: readonly number[]): number {
  return Math.max(0, ...counts.map((count, seat) => dealArrivalsMs(count, seat, counts.length, offsetMs, flightsMs[seat]).at(-1) ?? 0));
}
