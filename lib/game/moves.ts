import type { GameState, LastMove } from "./gameEngine.ts";

const seatOf = (move: LastMove): number => ("seat" in move ? move.seat : -1);

/**
 * The move `next` records if `seen` has not already accounted for it; null otherwise. Compared by
 * value, because a state re-sent over the wire is a new object for the same move.
 */
export function moveSince(seen: LastMove | null | undefined, next: LastMove): LastMove | null {
  if (!seen) return next;
  const same = seen.seq === next.seq && seen.kind === next.kind && seatOf(seen) === seatOf(next);
  return same ? null : next;
}

/**
 * Changes on every move, so a timer armed for one turn restarts on the next. Also the token a move
 * intent echoes from the wire state: opaque to the client, so its shape can change without a
 * protocol raise.
 */
export function turnOf(state: Pick<GameState, "lastMove">): string {
  return String(state.lastMove.seq);
}

/** A move intent made against any turn but the table's current one. */
export function isStaleTurn(state: Pick<GameState, "lastMove">, turn: string): boolean {
  return turn !== turnOf(state);
}
