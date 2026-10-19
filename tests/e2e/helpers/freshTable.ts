import { freshHandFloor } from "../../../lib/game/gameEngine.ts";

export interface SeatCount {
  testId: string;
  /** The seat's displayed card count, as text. */
  count: string;
}

/**
 * #785: the state an unplayed-table measurement requires, asserted rather than
 * hoped for. A seat below the floor a fresh deal leaves it has already played,
 * which makes this a different table than the record — measuring it anyway is
 * what reported a false layout break twice.
 *
 * `seats` are the opponent seats the table actually renders (#792), not the
 * seat count a table was asked for.
 */
export function assertFresh(seats: SeatCount[]): void {
  const seatsOnScreen = 1 + seats.length;
  const floor = freshHandFloor(seatsOnScreen);
  for (const seat of seats) {
    const text = seat.count.trim();
    if (!/^\d+$/.test(text)) {
      throw new Error(`cannot read seat count ${JSON.stringify(seat.count)} on the ${seat.testId} seat`);
    }
    const count = Number(text);
    if (count < floor) {
      throw new Error(
        `the ${seat.testId} seat already holds ${seat.count} card(s), fewer than the ` +
          `${floor} a fresh deal leaves any of this ${seatsOnScreen}-seat table's seats ` +
          `— this table has already been played into and cannot be measured against a ` +
          `record of an unplayed one`
      );
    }
  }
}
