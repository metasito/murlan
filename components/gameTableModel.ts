// Pure logic behind the one shared game table (components/GameTable.tsx).
//
// This file is deliberately JSX-free and free of *runtime* imports, for the
// same reason components/handLayout.ts is: Node's built-in TypeScript loader
// (`node --test tests/**/*.test.ts`) only type-strips plain .ts source — it
// cannot parse a .tsx file, and it cannot resolve the `@/` bundler alias at
// runtime. Type-only imports are erased before resolution, so they are safe;
// a value import from "@/lib/gameEngine" would break the test suite.

import type { Card, Combination, GameState, Player } from "@/lib/gameEngine";

// ─── Layout constants ─────────────────────────────────────────────────────────
//
// CLAUDE.md marks these as MUST NOT CHANGE: both game screens are laid out
// around them, and changing one without the other silently breaks a screen.
// They are defined here (rather than in GameShared.tsx, which re-exports them
// unchanged) so tests/gameTableModel.test.ts can pin their values and so the
// frame maths below can use them directly.

export const CARD_H = 84;
export const BTN_W = 84;
export const BTN_H = 84;
export const SIDE_BTN_W = 62;
export const TOP_BAR_H = 40;
export const TABLE_M = 4;
export const SIDE_SECTION_W = 130;
export const TOP_SECTION_H = 70;
export const HAND_SECTION_H = CARD_H + 16;

/** Web has no usable safe-area insets; both screens used these fixed pads. */
export const WEB_TOP_PAD = 67;
export const WEB_BOTTOM_PAD = 34;

// ─── Seating ──────────────────────────────────────────────────────────────────

export type FlyDirection = "top" | "bottom" | "left" | "right";
export type OpponentSide = "top" | "left" | "right";

/**
 * Which side of the table an opponent sits on, given how many seats clockwise
 * they are from the viewer and how many opponents there are in total.
 */
export function getOpponentPosition(steps: number, total: number): OpponentSide {
  if (total === 1) return "top";
  if (total === 2) return steps === 1 ? "right" : "top";
  if (steps === 1) return "right";
  if (steps === 2) return "top";
  return "left";
}

/**
 * Where a seat renders from the viewer's point of view. The viewer is always
 * at the bottom; everyone else is rotated around them. This is the single
 * source of truth for both the opponent slots and the flying-card direction —
 * the two screens used to compute it in four separate places each.
 */
export function seatDirection(
  seat: number,
  viewerSeat: number,
  playerCount: number
): FlyDirection {
  if (playerCount <= 0) return "bottom";
  if (seat === viewerSeat) return "bottom";
  const steps = (((seat - viewerSeat) % playerCount) + playerCount) % playerCount;
  return getOpponentPosition(steps, playerCount - 1);
}

export interface SeatedPlayer<T> {
  player: T;
  seat: number;
}

export interface OpponentArrangement<T> {
  top: SeatedPlayer<T> | null;
  left: SeatedPlayer<T> | null;
  right: SeatedPlayer<T> | null;
}

/**
 * Bucket every non-viewer seat into the top / left / right slot. First seat to
 * claim a slot keeps it, matching the `.find(...)` lookups this replaces.
 */
export function arrangeOpponents<T>(
  players: readonly T[],
  viewerSeat: number
): OpponentArrangement<T> {
  const out: OpponentArrangement<T> = { top: null, left: null, right: null };
  for (let seat = 0; seat < players.length; seat++) {
    if (seat === viewerSeat) continue;
    const dir = seatDirection(seat, viewerSeat, players.length);
    if (dir === "bottom") continue;
    if (out[dir] === null) out[dir] = { player: players[seat], seat };
  }
  return out;
}

/**
 * Cards left in a seat's hand. Online the server blanks other players' hands
 * and ships a `handCount` alongside; offline the hand itself is authoritative.
 */
export function handCountOf(player: Player | (Player & { handCount?: number })): number {
  const count = (player as { handCount?: number }).handCount;
  return typeof count === "number" ? count : player.hand.length;
}

// ─── Pile state ───────────────────────────────────────────────────────────────
//
// The pile shows at most two layers: the combination currently on the table and
// the faded one it beat. Getting this wrong made cards appear twice or not at
// all, which is why the transition is a pure function with its own tests.

export interface PileState {
  prev: Combination | null;
  current: Combination | null;
}

export const EMPTY_PILE: PileState = { prev: null, current: null };

// ─── Flight and impact timing ─────────────────────────────────────────────────
//
// A played combination flies from its seat to the pile before it arrives. Sound,
// haptics and the bomb's screen shake are the *impact*, so they belong at the
// moment the card lands — firing them at launch puts the bang a third of a
// second before the thing that caused it.
//
// FlyingCards (GameShared.tsx) owns the animation; these are the numbers both it
// and the table's feedback read, so the two cannot drift apart.

export const FLIGHT_MS = 380;
/** Fraction of the flight after which the card is on the felt and settling. */
export const LANDING_FRACTION = 0.82;

/** Delay from a play being registered to the card touching the pile. */
export function impactDelayMs(reduceMotion: boolean): number {
  // Under reduced motion FlyingCards skips the flight, so there is nothing to
  // wait for and the feedback fires immediately.
  return reduceMotion ? 0 : Math.round(FLIGHT_MS * LANDING_FRACTION);
}

/**
 * Identity of a played combination. Two different players playing the same
 * card ids is impossible, but the same player replaying an identical-looking
 * combination in a later round is not — hence the seat in the key.
 */
export function comboKey(combo: Combination, playedBy: number): string {
  return combo.cards.map((c) => c.id).join(",") + "_" + playedBy;
}

/** The old current becomes the faded layer; the new combination takes the top. */
export function advancePile(state: PileState, combo: Combination): PileState {
  return { prev: state.current, current: combo };
}

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

export type PlayButtonLabel = "GIOCA" | "NON\nVALIDA" | "TROPPO\nBASSA";

/**
 * Why the GIOCA button is dim. The online screen used to show a bare dim
 * "GIOCA" for every rejection reason; both screens now explain themselves.
 */
export function playButtonLabel(opts: {
  isMyTurn: boolean;
  isFinished: boolean;
  selectedCount: number;
  /** True when the selection forms a recognised combination at all. */
  comboBuilt: boolean;
}): PlayButtonLabel {
  if (!opts.isMyTurn || opts.isFinished) return "GIOCA";
  if (opts.selectedCount === 0) return "GIOCA";
  if (!opts.comboBuilt) return "NON\nVALIDA";
  return "TROPPO\nBASSA";
}

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
}): boolean {
  if (!opts.isMyTurn || opts.isFinished) return false;
  if (opts.gameOver || opts.exchangeActive) return false;
  if (opts.isNewRound && !opts.includeNewRound) return false;
  return true;
}

// ─── Start-card banner ────────────────────────────────────────────────────────

/**
 * Italian copy for the pre-first-play banner. Existed offline only; the online
 * screen showed an empty pile instead.
 */
export function startCardBannerText(opts: {
  card: Card;
  starterName: string;
  viewerIsStarter: boolean;
}): string {
  // The opening card is always the 3 of spades (docs/RULES.md §Opening), which
  // is why the suit glyph is fixed here and in GameShared's StartReasonBanner.
  const label = `${opts.card.rank}♠`;
  return opts.viewerIsStarter
    ? `Inizi tu! Hai il ${label}`
    : `${opts.starterName} inizia con il ${label}`;
}

// ─── Table frame ──────────────────────────────────────────────────────────────

export interface EdgeInsets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface ScreenPads {
  topPad: number;
  bottomPad: number;
  leftPad: number;
  rightPad: number;
}

/**
 * Usable screen edges. React Native Web reports no useful safe-area insets, so
 * both screens have always substituted these fixed pads there.
 */
export function computeScreenPads(opts: { insets: EdgeInsets; isWeb: boolean }): ScreenPads {
  return {
    topPad: opts.isWeb ? WEB_TOP_PAD : opts.insets.top,
    bottomPad: opts.isWeb ? WEB_BOTTOM_PAD : opts.insets.bottom,
    leftPad: opts.isWeb ? 0 : opts.insets.left,
    rightPad: opts.isWeb ? 0 : opts.insets.right,
  };
}

export interface TableFrame extends ScreenPads {
  tableLeft: number;
  tableTop: number;
  tableRight: number;
  tableBottom: number;
  /** Width available to the hand row between the PASSA and GIOCA buttons. */
  handAvailW: number;
}

/**
 * Absolute coordinates of the felt and the hand row. Both screens computed
 * this identically apart from an intermediate variable; `tableRight` and
 * `tableBottom` are distances from the right/bottom edge, matching the
 * absolutely-positioned `right` / `bottom` style props they feed.
 */
export function computeTableFrame(opts: {
  width: number;
  insets: EdgeInsets;
  isWeb: boolean;
}): TableFrame {
  const { topPad, bottomPad, leftPad, rightPad } = computeScreenPads(opts);

  const tableLeft = leftPad + TABLE_M;
  const tableTop = topPad + TOP_BAR_H + TABLE_M;
  const tableRight = rightPad + TABLE_M;
  const tableBottom = bottomPad + TABLE_M;

  return {
    topPad,
    bottomPad,
    leftPad,
    rightPad,
    tableLeft,
    tableTop,
    tableRight,
    tableBottom,
    handAvailW: opts.width - tableLeft - tableRight - (SIDE_BTN_W + 8) * 2 - 8,
  };
}

// ─── Exchange phase ───────────────────────────────────────────────────────────

export interface ExchangeView {
  active: boolean;
  /** The viewer owes the loser a card and must pick one. */
  viewerIsWinner: boolean;
  /** The viewer is waiting to receive a card. */
  viewerIsLoser: boolean;
  winner: Player | null;
  loser: Player | null;
}

export const INACTIVE_EXCHANGE: ExchangeView = {
  active: false,
  viewerIsWinner: false,
  viewerIsLoser: false,
  winner: null,
  loser: null,
};

export function readExchange(state: GameState, viewerSeat: number): ExchangeView {
  const phase = state.exchangePhase;
  if (!phase?.active) return INACTIVE_EXCHANGE;
  return {
    active: true,
    viewerIsWinner: phase.winnerIdx === viewerSeat,
    viewerIsLoser: phase.loserIdx === viewerSeat,
    winner: state.players[phase.winnerIdx] ?? null,
    loser: state.players[phase.loserIdx] ?? null,
  };
}

// ─── Screen-reader description ─────────────────────────────────────────────────
//
// A blind player cannot see the fan of face-down cards, the pile, or whose
// avatar is glowing — this is the whole table in words. Pure and
// translation-agnostic: every phrase arrives already translated from
// GameTable.tsx (either a literal string or a small formatter function), so
// this stays testable under `node --test` without the i18n runtime. Ordered
// by tactical importance for someone who cannot see the board: whose turn it
// is, what was last played and by whom, how many cards each opponent holds
// (the single most important signal the card fan gives a sighted player for
// free), and finally the viewer's own hand size.

export interface TableA11yOpponent {
  name: string;
  cardCount: number;
}

export interface TableA11yLastPlay {
  /** Already-translated description of the play, e.g. "coppia di 8". */
  label: string;
  byViewer: boolean;
  /** Ignored when `byViewer` is true. */
  byName: string;
}

export interface TableA11yExchange {
  active: boolean;
  viewerIsWinner: boolean;
  viewerIsLoser: boolean;
  /** Ignored unless `viewerIsLoser`. */
  winnerName: string;
  /** Ignored unless `viewerIsWinner`. */
  loserName: string;
}

export interface TableA11yStrings {
  yourTurn: string;
  turnOf: (name: string) => string;
  emptyTable: string;
  youPlayed: (label: string) => string;
  playerPlayed: (name: string, label: string) => string;
  opponentCardCount: (name: string, count: number) => string;
  yourCardCount: (count: number) => string;
  exchangeGiveCard: (loserName: string) => string;
  exchangeWaitForCard: (winnerName: string) => string;
}

export interface TableA11yInput {
  isMyTurn: boolean;
  /** Ignored when `isMyTurn` is true. */
  currentTurnName: string;
  myCardCount: number;
  /** Null when nobody has led the round yet. */
  lastPlay: TableA11yLastPlay | null;
  /** Every opponent — never the viewer. */
  opponents: TableA11yOpponent[];
  exchange?: TableA11yExchange;
}

/**
 * Assembles the table into one sentence-per-fact description, in the fixed
 * priority order above. The exchange phase (§10 of docs/RULES.md) replaces
 * the turn sentence for whichever of the two players it actually concerns —
 * a bystander mid-exchange just sees the ordinary turn state, since nothing
 * is asked of them.
 */
export function describeTableForA11y(input: TableA11yInput, strings: TableA11yStrings): string {
  const parts: string[] = [];

  if (input.exchange?.active && (input.exchange.viewerIsWinner || input.exchange.viewerIsLoser)) {
    parts.push(
      input.exchange.viewerIsWinner
        ? strings.exchangeGiveCard(input.exchange.loserName)
        : strings.exchangeWaitForCard(input.exchange.winnerName)
    );
  } else {
    parts.push(input.isMyTurn ? strings.yourTurn : strings.turnOf(input.currentTurnName));
  }

  parts.push(
    input.lastPlay
      ? input.lastPlay.byViewer
        ? strings.youPlayed(input.lastPlay.label)
        : strings.playerPlayed(input.lastPlay.byName, input.lastPlay.label)
      : strings.emptyTable
  );

  for (const opp of input.opponents) {
    parts.push(strings.opponentCardCount(opp.name, opp.cardCount));
  }

  parts.push(strings.yourCardCount(input.myCardCount));

  return parts.join(" ");
}

const FACE_VALUE_RANK: Record<number, string> = {
  1: "A", 2: "2", 3: "3", 4: "4", 5: "5", 6: "6", 7: "7", 8: "8", 9: "9", 10: "10",
  11: "J", 12: "Q", 13: "K", 14: "A",
};

/**
 * A straight's `Combination.strength` is already the correct top-of-sequence
 * face value — `getStraightStrength` in lib/gameEngine.ts knows the
 * ace-high-vs-ace-low rule (docs/RULES.md §6: the 2 is low-only, so a
 * straight containing it is unambiguously ace-low) and returns the winning
 * interpretation as a number. This just renders that number back as the rank
 * character a player recognises, for the spoken "top card" of a straight or
 * royal straight. Naively taking `cards[cards.length - 1].rank` would get
 * A-2-3-4-5 wrong (its top card is 5, not 2 or A) — this sidesteps that by
 * reusing the engine's own already-correct number instead of re-deriving it.
 */
export function straightTopRankChar(strength: number): string {
  return FACE_VALUE_RANK[strength] ?? String(strength);
}
