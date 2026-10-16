// JSX-free, runtime imports relative — docs/agents/checks.md, "Node's TypeScript loader".
import { handCountOf, vacatedOf } from "../../shared/protocol.ts";

/** What every opponent seat reads off the table. */
export type SeatTable = {
  /** The seat lit as on move; `null` while an exchange or the round's outcome holds the turn. */
  onMoveSeat: number | null;
  passed: readonly number[];
  disconnectedSeats: Readonly<Record<number, { seconds: number; resetKey: string }>>;
  exchangeLit: readonly number[];
  /** Cards in the air in the exchange, by the seat they count against. */
  exchangeShift: ReadonlyMap<number, number>;
};

/** One seat's own props for `OpponentSeat`, each a separate value so the memoized seat skips an unchanged commit. */
export function seatView(seat: number, player: Parameters<typeof handCountOf>[0], table: SeatTable) {
  return {
    seat,
    isActive: seat === table.onMoveSeat,
    cardCount: handCountOf(player) + (table.exchangeShift.get(seat) ?? 0),
    passed: table.passed.includes(seat),
    vacated: vacatedOf(player),
    reconnecting: table.disconnectedSeats[seat],
    marked: table.exchangeLit.includes(seat),
  };
}
