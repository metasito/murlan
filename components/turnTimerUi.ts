// What the play/pass controls say, and when the turn clock is running.
//
// JSX-free, runtime imports relative — docs/agents/checks.md, "Node's TypeScript loader".

import type { Combination, PlayRefusal } from "@/lib/game/gameEngine";

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

/**
 * Why a selection cannot be played. Identifiers, not copy: GameTable.tsx maps
 * each to a short button label and to the longer sentence a screen reader (and
 * the rejection toast) speaks. Only the refusals a selection itself earns: one
 * drawn from the hand is always held.
 */
export type PlayButtonLabel = "play" | Exclude<PlayRefusal, "exchangeOpen" | "notHeld">;

/** As much of a combination as the rejection ladder needs. */
export interface ComboShape {
  type: Combination["type"];
  length: number;
}

/**
 * Why the GIOCA button is dim, in the same reason order `checkPlay`
 * (lib/game/gameEngine.ts) refuses in — so a pair offered against a single is told
 * it is the wrong shape, and the opening play is told it needs the 3♠, rather
 * than both being called too low. `tests/ui-rules/playRefusalParity.test.ts`
 * holds the two to the same answer.
 *
 * Answers "why would this be refused"; the caller decides whether to show it,
 * because only the caller can run the engine — this takes a `ComboShape`, and
 * `checkPlay` wants the whole cards.
 */
export function playButtonLabel(opts: {
  isMyTurn: boolean;
  isFinished: boolean;
  selectedCount: number;
  /** The selection's shape, null when it is not a recognised combination. */
  selection: ComboShape | null;
  /** What has to be beaten. Null while leading a new trick. */
  pile: ComboShape | null;
  /** The opening play of a round must contain the 3♠. */
  requiresStartCard: boolean;
  selectionHasStartCard: boolean;
}): PlayButtonLabel {
  if (!opts.isMyTurn || opts.isFinished) return "play";
  if (opts.selectedCount === 0) return "play";

  const selection = opts.selection;
  if (selection === null) return "notACombination";
  if (opts.requiresStartCard && !opts.selectionHasStartCard) return "needsStartCard";

  const pile = opts.pile;
  if (pile === null) return "play";

  if (selection.type === "royal_straight") {
    // A royal straight answers everything except a same-length higher one.
    return pile.type === "royal_straight" && selection.length !== pile.length
      ? "wrongLength"
      : "tooLow";
  }
  if (selection.type === "bomb") {
    if (pile.type === "royal_straight") return "royalUnbeatable";
    return "tooLow";
  }
  if (pile.type === "royal_straight") return "royalUnbeatable";
  if (pile.type === "bomb") return "bombOnly";
  if (selection.type !== pile.type) return "wrongType";
  if (selection.length !== pile.length) return "wrongLength";
  return "tooLow";
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
