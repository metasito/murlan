import { useEffect, useRef, useState } from "react";
import type { HandOutcome } from "@/lib/game/matchState";
import type { TableTimeline } from "./tableTimeline";

export type ShownOutcome = Exclude<HandOutcome, "pending">;

/**
 * The manche's outcome from the landing of the play that ended it, once decided, until the next
 * deal. Call it after `usePileFlight`: `pending()` is read at call time, so this effect sees the
 * throw that ended the manche.
 */
export function useMancheOutcome({
  ended,
  outcome,
  timeline,
}: {
  ended: boolean;
  outcome: HandOutcome;
  timeline: Pick<TableTimeline, "inFlight" | "pending">;
}): ShownOutcome | null {
  const [shown, setShown] = useState<ShownOutcome | null>(null);
  // Through a ref: the outcome is latched in an effect, after `usePileFlight`'s has taken the throw.
  const show = useRef(setShown);
  const { inFlight, pending } = timeline;
  useEffect(() => {
    if (!ended) show.current(null);
    else if (outcome !== "pending" && !inFlight && !pending()) show.current((s) => s ?? outcome);
  }, [ended, outcome, inFlight, pending]);
  return shown;
}
