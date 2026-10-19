// What the play/pass controls say, and when the turn clock is running.
//
// JSX-free, runtime imports relative — docs/agents/checks.md, "Node's TypeScript loader".

// ─── Play / pass affordances ──────────────────────────────────────────────────

export interface TurnFacts {
  isMyTurn: boolean;
  isFinished: boolean;
  isNewTrick: boolean;
}

/** Leading a trick is compulsory: you may only pass in answer to a combination. */
export function canPassNow(facts: TurnFacts): boolean {
  return !facts.isNewTrick && facts.isMyTurn && !facts.isFinished;
}

/** Seconds left at which the clock-running-out sound starts. */
export const CLOCK_RUNNING_OUT_SECONDS = 4;
/** …and the share of the clock it spends visibly urgent. */
const URGENT_FRACTION = 0.4;

/**
 * When the countdown turns red, given how long it runs for. Proportional
 * rather than fixed because a five-second warning on a short clock arrives
 * too late to act on. The clock-running-out sound keeps its own fixed, later
 * threshold — a warning you can see for twelve seconds is fine, one you can
 * hear for twelve seconds is nagging.
 */
export function urgentThresholdSeconds(clockSeconds: number): number {
  return Math.max(CLOCK_RUNNING_OUT_SECONDS, Math.ceil(clockSeconds * URGENT_FRACTION));
}

/**
 * Whether the turn countdown should run. Offline it only answers a played
 * combination (leading has no deadline); online it mirrors the server's AFK
 * window, which is armed on every turn — hence `includeNewTrick`.
 */
export function turnTimerActive(opts: {
  isMyTurn: boolean;
  isFinished: boolean;
  isNewTrick: boolean;
  roundOver: boolean;
  exchangeActive: boolean;
  includeNewTrick: boolean;
  /**
   * An announcement is holding the table, and this client owns the deadline it
   * would be holding. A pause a server is not keeping would draw a clock with
   * more time on it than the seat actually has, so the caller passes false
   * online however long the announcement is up.
   */
  announcementHolds?: boolean;
}): boolean {
  if (!opts.isMyTurn || opts.isFinished) return false;
  if (opts.roundOver || opts.exchangeActive) return false;
  if (opts.announcementHolds) return false;
  if (opts.isNewTrick && !opts.includeNewTrick) return false;
  return true;
}
