// What the play/pass controls say, and when the turn clock is running.
//
// This file is deliberately JSX-free, for the same reason components/handLayout.ts
// is: Node's built-in TypeScript loader (`node --test tests/**/*.test.ts`) only
// type-strips plain .ts source — it cannot parse a .tsx file, and it cannot
// resolve the `@/` bundler alias at runtime. A runtime import must therefore be
// relative and carry its .ts extension; `@/` is safe only in a type-only import,
// which is erased before resolution.

import type { Combination } from "@/lib/gameEngine";

// ─── Play / pass affordances ──────────────────────────────────────────────────

export interface TurnFacts {
  isMyTurn: boolean;
  isFinished: boolean;
  isNewRound: boolean;
}

/** Leading a round is compulsory: you may only pass in answer to a combination. */
export function canPassNow(facts: TurnFacts): boolean {
  return !facts.isNewRound && facts.isMyTurn && !facts.isFinished;
}

/**
 * Why a selection cannot be played. Identifiers, not copy: GameTable.tsx maps
 * each to a short button label and to the longer sentence a screen reader (and
 * the rejection toast) speaks.
 */
export type PlayButtonLabel =
  | "play"
  | "notACombination"
  | "needsStartCard"
  | "royalUnbeatable"
  | "bombOnly"
  | "wrongType"
  | "wrongLength"
  | "tooLow";

/** As much of a combination as the rejection ladder needs. */
export interface ComboShape {
  type: Combination["type"];
  length: number;
}

/**
 * Why the GIOCA button is dim, in the same reason order `canPlay`
 * (lib/gameEngine.ts) refuses in — so a pair offered against a single is told
 * it is the wrong shape, and the opening play is told it needs the 3♠, rather
 * than both being called too low.
 *
 * Answers "why would this be refused"; the caller decides whether to show it,
 * because only the caller can run `canPlay` — this takes a `ComboShape`, and
 * `canPlay` wants the two whole `Combination`s.
 */
export function playButtonLabel(opts: {
  isMyTurn: boolean;
  isFinished: boolean;
  selectedCount: number;
  /** The selection's shape, null when it is not a recognised combination. */
  selection: ComboShape | null;
  /** What has to be beaten. Null while leading a new round. */
  pile: ComboShape | null;
  /** The opening play of a hand must contain the start card. */
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

/** Seconds left at which the countdown starts ticking audibly. */
export const URGENT_TICK_SECONDS = 5;
/** …and the share of the clock it spends visibly urgent. */
const URGENT_FRACTION = 0.4;

/**
 * When the countdown turns red, given how long it runs for. Proportional
 * rather than fixed because the offline clock is 20s against the server's 30s,
 * and a warning that arrives five seconds from the end of the shorter one
 * arrives too late to act on. The audible tick keeps its own fixed, later
 * threshold — a warning you can see for twelve seconds is fine, one you can
 * hear for twelve seconds is nagging.
 */
export function urgentThresholdSeconds(clockSeconds: number): number {
  return Math.max(URGENT_TICK_SECONDS, Math.ceil(clockSeconds * URGENT_FRACTION));
}

// Shared with the server (#830), which grants the opener's first turn a
// longer AFK window on the same condition.
export { openingIsPending } from "../lib/gameEngine.ts";

/**
 * Whether the turn countdown should run. Offline it only answers a played
 * combination (leading has no deadline); online it mirrors the server's AFK
 * window, which is armed on every turn — hence `includeNewRound`.
 */
export function turnTimerActive(opts: {
  isMyTurn: boolean;
  isFinished: boolean;
  isNewRound: boolean;
  gameOver: boolean;
  exchangeActive: boolean;
  includeNewRound: boolean;
  /**
   * An announcement is holding the table, and this client owns the deadline it
   * would be holding. A pause a server is not keeping would draw a clock with
   * more time on it than the seat actually has, so the caller passes false
   * online however long the announcement is up.
   */
  announcementHolds?: boolean;
}): boolean {
  if (!opts.isMyTurn || opts.isFinished) return false;
  if (opts.gameOver || opts.exchangeActive) return false;
  if (opts.announcementHolds) return false;
  if (opts.isNewRound && !opts.includeNewRound) return false;
  return true;
}
