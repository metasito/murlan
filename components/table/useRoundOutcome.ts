import { useState } from "react";
import type { RoundOutcome } from "@/lib/game/matchState";

export type ShownOutcome = Exclude<RoundOutcome, "pending">;

/** The round's outcome from the landing of the play that ended it, once decided, until the next round. */
export function useRoundOutcome({
  ended,
  outcome,
  landed,
}: {
  ended: boolean;
  outcome: RoundOutcome;
  /** `usePileFlight`'s `ending.landedAt`. */
  landed: number | null;
}): ShownOutcome | null {
  const [shown, setShown] = useState<ShownOutcome | null>(null);
  const next = !ended ? null : (shown ?? (outcome !== "pending" && landed !== null ? outcome : null));
  if (next !== shown) setShown(next);
  return next;
}
