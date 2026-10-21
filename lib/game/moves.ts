import type { LastMove } from "./gameEngine.ts";

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
