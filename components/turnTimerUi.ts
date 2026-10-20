// Whether passing is open, and when the turn clock is running.
//
// JSX-free, runtime imports relative — docs/agents/checks.md, "Node's TypeScript loader".

import type { TFn, TranslationKey } from "@/lib/i18n";

// ─── Pass affordance ─────────────────────────────────────────────────────────

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

/** The urgent ring's 1Hz dim-and-back: a repeating beat, not a one-shot transition, so not a Motion step. */
export const RING_PULSE_MS = 1000;

/** How many beats the ring has left to pulse; 0 means none. */
export function pulseRepeats(urgentMs: number, leftMs: number): number {
  return Math.ceil(Math.min(urgentMs, leftMs) / RING_PULSE_MS);
}

// ─── The turn, presented ─────────────────────────────────────────────────────

export interface TurnTimerConfig {
  /** Length of the countdown, in seconds. */
  seconds: number;
  /**
   * Restarts the countdown when it changes, on top of the turn itself. Online
   * the server re-arms its window on paths that change no state — a rejoin,
   * a disconnect — and the clock has to follow.
   */
  resetKey?: string;
  /**
   * The viewer's own chip counts down while leading a new trick too (seat rings
   * always do). False offline, no deadline; true online, armed every turn.
   */
  includeNewTrick?: boolean;
  /**
   * Called when the countdown reaches zero. Offline this auto-passes locally;
   * online it is omitted, because the server owns the timeout and the client
   * countdown is only a display of it.
   */
  onExpire?: () => void;
  /**
   * Whether this client owns the deadline, and may therefore stop the clock
   * while an announcement is holding the table. True offline. False online:
   * the server's AFK window keeps running whatever the client draws, so a
   * pause here would show a seat more time than it has.
   */
  pausable?: boolean;
}

export type TurnState = "matchOver" | "roundOver" | "dealing" | "yourTurn" | "turnOf";

export function turnState(i: { roundOver: boolean; matchOver: boolean; dealing: boolean; viewerOnMove: boolean }): TurnState {
  if (i.roundOver) return i.matchOver ? "matchOver" : "roundOver";
  if (i.dealing) return "dealing";
  return i.viewerOnMove ? "yourTurn" : "turnOf";
}

const CHIP_KEYS: Record<TurnState, TranslationKey> = {
  matchOver: "gameShared.matchOver",
  roundOver: "gameShared.roundOver",
  dealing: "gameShared.dealing",
  yourTurn: "gameShared.yourTurn",
  turnOf: "gameShared.turnOf",
};

const SPOKEN_KEYS: Record<TurnState, TranslationKey> = {
  matchOver: "gameTable.a11yMatchOver",
  roundOver: "gameTable.a11yRoundOver",
  dealing: "gameTable.a11yDealing",
  yourTurn: "gameTable.a11yYourTurn",
  turnOf: "gameTable.a11yTurnOf",
};

export interface TurnClock {
  active: boolean;
  /** Whether the count is drawn: the viewer's seat is on move, or a vote is counting. */
  revealed: boolean;
}

export interface TurnPresentation {
  chip: { text: string; spoken: string; lit: boolean };
  clock: TurnClock;
  /** Whether the seat on move draws its ring. */
  seatClock: boolean;
  /** The one window the chip and the ring both read. */
  window: { seconds: number; resetKey: string; running: boolean; held: boolean; onExpire?: () => void };
}

/** The turn chip, its countdown and the seat ring's, from one reading of the turn. */
export function turnPresentation(i: {
  roundOver: boolean;
  /** Read only with `roundOver`. */
  matchOver: boolean;
  dealing: boolean;
  /** The seat the table shows on move is the viewer's; `isMyTurn` is the true turn. */
  shownTurnIsMine: boolean;
  onMoveName: string;
  /** `chip` outranks the state. */
  exchange: { chip: string | null; choiceOpen: boolean; viewerIsWinner: boolean; active: boolean };
  timer?: TurnTimerConfig;
  /** The next-round vote's deadline, which takes the chip's countdown while no turn runs. */
  vote?: { seconds: number; resetKey: string } | null;
  isMyTurn: boolean;
  isFinished: boolean;
  isNewTrick: boolean;
  holdingForStart: boolean;
  held: boolean;
  turnToken: string;
  t: TFn;
}): TurnPresentation {
  const { exchange, timer, vote, roundOver } = i;
  const clockShown = i.shownTurnIsMine && !i.isFinished && !roundOver;
  const state = turnState({ roundOver, matchOver: i.matchOver, dealing: i.dealing, viewerOnMove: clockShown && !i.dealing });
  const say = (key: TranslationKey) => (state === "turnOf" ? i.t(key, { name: i.onMoveName }) : i.t(key));
  const announcementHolds = i.holdingForStart && (timer?.pausable ?? false);
  // The ring only ever sits on a seat whose turn it is, and never on one that has gone out:
  // `getNextActivePlayer` (lib/game/gameEngine.ts) steps over an empty hand.
  const runs = (who: { isMyTurn: boolean; isFinished: boolean; includeNewTrick: boolean }) =>
    !!timer &&
    turnTimerActive({ ...who, isNewTrick: i.isNewTrick, roundOver, exchangeActive: exchange.active, announcementHolds });
  const turnResetKey = `${i.turnToken}|${timer?.resetKey ?? ""}`;
  const active = runs({ isMyTurn: i.isMyTurn, isFinished: i.isFinished, includeNewTrick: timer?.includeNewTrick ?? false });
  // The seat runs whenever the chip does and on more: offline, a lead runs the window though the
  // chip has no deadline there, so only an active chip's turn expires.
  const seatClock = !!timer && runs({ isMyTurn: true, isFinished: false, includeNewTrick: true });
  return {
    chip: {
      text: exchange.chip ?? say(CHIP_KEYS[state]),
      spoken: exchange.chip ?? say(SPOKEN_KEYS[state]),
      lit: exchange.chip === null ? state === "yourTurn" : exchange.choiceOpen && exchange.viewerIsWinner,
    },
    clock: vote ? { active: true, revealed: true } : { active, revealed: clockShown },
    seatClock,
    window: vote
      ? { seconds: vote.seconds, resetKey: `vote|${vote.resetKey}`, running: true, held: false }
      : {
          seconds: timer?.seconds ?? 0,
          resetKey: turnResetKey,
          running: seatClock,
          held: i.held,
          onExpire: active ? timer?.onExpire : undefined,
        },
  };
}
