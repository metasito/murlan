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

/** Changes on every move, so a timer armed for one turn restarts on the next. */
export function turnOf(state: Pick<GameState, "lastMove">): string {
  return String(state.lastMove.seq);
}

/** What a move intent names as the state it was made against; one made against any other is stale. */
export function intentSeq(state: Pick<GameState, "lastMove">): number {
  return state.lastMove.seq;
}

export function isStaleIntent(state: Pick<GameState, "lastMove">, seq: number): boolean {
  return seq !== intentSeq(state);
}
