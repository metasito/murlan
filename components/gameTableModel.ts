// Pure logic behind the one shared game table (components/GameTable.tsx).
//
// This file is deliberately JSX-free, for the same reason components/handLayout.ts
// is: Node's built-in TypeScript loader (`node --test tests/**/*.test.ts`) only
// type-strips plain .ts source — it cannot parse a .tsx file, and it cannot
// resolve the `@/` bundler alias at runtime. A runtime import must therefore be
// relative and carry its .ts extension; `@/` is safe only in a type-only import,
// which is erased before resolution.

import type { Card, Combination, GameState, Player } from "@/lib/gameEngine";
import { getCardDisplayRank, getSuitSymbol } from "../lib/gameEngine.ts";
import { CARD_H, CARD_W, cardScale } from "./cardFaceModel.ts";

// ─── Layout constants ─────────────────────────────────────────────────────────
//
// CLAUDE.md marks these as MUST NOT CHANGE: both game screens are laid out
// around them, and changing one without the other silently breaks a screen.
// The card dimensions belong to cardFaceModel.ts, which draws the card; the
// rest are defined here (rather than in the components/table/ files that read
// them) so tests/gameTableModel.test.ts can pin their values and so the frame
// maths below can use them directly.

export { CARD_H, CARD_W, cardScale };
export const BTN_W = 84;
export const BTN_H = 84;
export const SIDE_BTN_W = 62;
export const TOP_BAR_H = 40;
export const TABLE_M = 4;
export const SIDE_SECTION_W = 130;
export const TOP_SECTION_H = 70;
/**
 * Headroom above the hand row's own cards — enough to clear a selected card's
 * lift (SELECT_LIFT, components/table/hand.tsx) without the row above it
 * shifting. hand.tsx reuses this same number as its scrollable fallback's own
 * top clearance, so the two cannot drift apart.
 */
export const HAND_ROW_HEADROOM = 16;

/** The hand row's own height — headroom above its (already-scaled) cards. */
export function HAND_SECTION_H(cardH: number): number {
  return cardH + HAND_ROW_HEADROOM;
}

// ─── Fan geometry ─────────────────────────────────────────────────────────────
//
// Where each card sits inside a fan. Every fan on the table reads it from here:
// a combination mid-throw and the same combination the frame after it lands are
// one call, so it cannot shift as it arrives.

/** A combination in the pile, thrown or landed. */
export type FanKind = "combo" | "opponent";

export interface FanOffsets {
  /** Horizontal distance (px) between the left edges of adjacent cards. */
  step: number;
  /** Tilt (deg) of the card furthest from the middle. */
  angle: number;
  /** Full span (px): left edge of the first card to the right edge of the last. */
  totalW: number;
}

const OPPONENT_STEP = 15;
const OPPONENT_MAX_ANGLE = 22;
/**
 * Cards thrown onto a table do not land square, so a combination is jittered
 * rather than fanned — see cardTilt. The bound stays small: past a few degrees
 * the overlap stops reading as one combination.
 */
const COMBO_MAX_TILT = 4.5;

/** `cardW` is the caller's own already-scaled card width for this fan's kind. */
export function fanOffsets(count: number, kind: FanKind, cardW: number): FanOffsets {
  if (kind === "opponent") {
    return {
      step: OPPONENT_STEP,
      angle: OPPONENT_MAX_ANGLE,
      totalW: OPPONENT_STEP * (count - 1) + cardW,
    };
  }
  const step = count > 8 ? 9 : count > 5 ? 12 : 14;
  return { step, angle: COMBO_MAX_TILT, totalW: step * (count - 1) + cardW };
}

/**
 * A card's own tilt (deg) inside a combo fan, derived from its id so the same
 * combination looks the same on every client and in every frame of its throw.
 */
export function cardTilt(id: string, maxTilt: number): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return ((Math.abs(hash) % 200) / 100 - 1) * maxTilt;
}

/**
 * Left offset (px) of card `i` in a fan centred on its own midpoint, rather
 * than laid out from a left edge. `cardW` must be the same width `fanOffsets`
 * or `computeHandLayout` produced `totalW` from.
 */
export function fanCenterOffset(i: number, step: number, totalW: number, cardW: number): number {
  return i * step - (totalW - cardW) / 2;
}

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
 * at the bottom; everyone else is rotated around them. The single source of
 * truth for both the opponent slots and the flying-card direction.
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
// FlyingCards (components/table/pile.tsx) owns the animation; these are the numbers both it
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

/**
 * The pass that just closed a round, seen from one state. `processPass`
 * (lib/gameEngine.ts) clears `lastPlayedCombination` and credits `roundWinner`
 * in the same transition, so the table gets both on a single commit — and the
 * winning cards must stay on the felt under the tag that announces them
 * instead of being wiped by the empty-table branch.
 */
export function roundClosedWithWinner(state: {
  lastPlayedCombination: Combination | null;
  roundWinner?: number | null;
}): boolean {
  return (
    state.lastPlayedCombination === null &&
    state.roundWinner !== null &&
    state.roundWinner !== undefined
  );
}

/**
 * The seats that have passed in the round on the table, in pass order.
 *
 * A pass changes nothing visible, so this derives it from what did: turns run
 * from `lastPlayedBy` in *descending* seat order and the pile only moves on a
 * play, so every seat in between has passed. Seats holding no cards are
 * stepped over — a false marker is worse than none.
 *
 * Empty between rounds, and empty when the seat on move is the one that
 * played: that span is a full circle. `outOfCards` carries the seat count.
 */
export function passedSeats(state: {
  currentTurnIndex: number;
  lastPlayedBy: number;
  lastPlayedCombination: Combination | null;
  /** Indexed by seat: true once that seat holds no cards. */
  outOfCards: readonly boolean[];
}): number[] {
  const { currentTurnIndex, lastPlayedBy, outOfCards } = state;
  const seatCount = outOfCards.length;
  if (state.lastPlayedCombination === null) return [];
  if (lastPlayedBy < 0 || lastPlayedBy >= seatCount) return [];
  if (currentTurnIndex === lastPlayedBy) return [];

  const passed: number[] = [];
  for (let step = 1; step < seatCount; step++) {
    const seat = (((lastPlayedBy - step) % seatCount) + seatCount) % seatCount;
    if (seat === currentTurnIndex) break;
    if (outOfCards[seat]) continue;
    passed.push(seat);
  }
  return passed;
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
 * because only the caller can run `canPlay` (this file takes no runtime import
 * from the engine).
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
  // At 2 players the opening card can be the fallback "lowest dealt card"
  // rather than the 3♠ (docs/RULES.md §4), so the suit is read off the card
  // rather than assumed.
  const label = `${getCardDisplayRank(opts.card.rank)}${getSuitSymbol(opts.card.suit)}`;
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
 * Usable screen edges, straight from `useSafeAreaInsets()`. On web that reads
 * the real `env(safe-area-inset-*)` values (react-native-safe-area-context's
 * web polyfill), which requires `viewport-fit=cover` on the viewport meta —
 * see public/index.html — or every side reads 0 regardless of device.
 */
export function computeScreenPads(opts: { insets: EdgeInsets }): ScreenPads {
  return {
    topPad: opts.insets.top,
    bottomPad: opts.insets.bottom,
    leftPad: opts.insets.left,
    rightPad: opts.insets.right,
  };
}

// ─── Control rail ─────────────────────────────────────────────────────────────
//
// A cutout can never sit on a card, but it sits happily between two controls.
// The column the cutout occupies is the rail: menu knob at the top, reactions
// knob at the bottom, cutout in the gap between them.

/** Air on both sides of a 44pt knob — the width the rail holds with no cutout. */
const RAIL_FLOOR = 58;
/** …and what it grows to on a large screen, before any cutout is considered. */
const RAIL_SCALED = 52;
/** Clearance between the cutout's own edge and the knobs either side of it. */
const RAIL_CUTOUT_CLEARANCE = 12;

/**
 * The rail's width. The floor is what keeps a notchless phone laid out exactly
 * like a notched one: below `RAIL_FLOOR - RAIL_CUTOUT_CLEARANCE` of inset the
 * rail is already wider than the cutout, so the cutout appearing moves nothing.
 */
export function railWidth(insetLeft: number, scale: number): number {
  return Math.max(RAIL_FLOOR, RAIL_SCALED * scale, insetLeft + RAIL_CUTOUT_CLEARANCE);
}

export interface TableFrame extends ScreenPads {
  /** Width of the control rail, which is also the play area's left edge. */
  rail: number;
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
  /** The table's own scale — the rail widens with it. */
  scale: number;
}): TableFrame {
  const { topPad, bottomPad, leftPad, rightPad } = computeScreenPads(opts);

  // The rail eats the left edge, so the play area starts at its outer edge and
  // everything centred on the table centres on that box rather than on the
  // screen — centring on 50% puts the pile and the top seat ~17px off on an
  // 844pt phone.
  const rail = railWidth(leftPad, opts.scale);
  const tableLeft = rail;
  const tableTop = topPad + TOP_BAR_H + TABLE_M;
  const tableRight = rightPad + TABLE_M;
  const tableBottom = bottomPad + TABLE_M;

  return {
    topPad,
    bottomPad,
    leftPad,
    rightPad,
    rail,
    tableLeft,
    tableTop,
    tableRight,
    tableBottom,
    handAvailW: opts.width - tableLeft - tableRight - (SIDE_BTN_W + 8) * 2 - 8,
  };
}

/**
 * Top edge the notification banner may start at without covering the game
 * table's top bar — which carries whose turn it is, the countdown and the hand
 * count, exactly the things an AFK or takeover notice is explaining.
 *
 * Landscape is the proxy for "the table is up": it is the only orientation the
 * table runs in, and on a menu screen in landscape the band the banner steps
 * over is empty, so it costs nothing there.
 */
export function notificationTopOffset(opts: { topPad: number; landscape: boolean }): number {
  return opts.landscape ? opts.topPad + TOP_BAR_H + TABLE_M : opts.topPad;
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
// The whole table in words. Every phrase arrives already translated from
// GameTable.tsx, so this stays testable under `node --test` with no i18n
// runtime. Ordered by tactical importance to someone who cannot see the board:
// whose turn, what was last played and by whom, each opponent's card count,
// then the viewer's own hand size.

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
 * Renders a straight's `Combination.strength` — already the correct
 * top-of-sequence face value, ace-high-vs-ace-low resolved by
 * `getStraightStrength` — back as a rank character, for the spoken top card.
 *
 * Taking `cards[cards.length - 1].rank` instead gets A-2-3-4-5 wrong: its top
 * card is 5.
 */
export function straightTopRankChar(strength: number): string {
  return FACE_VALUE_RANK[strength] ?? String(strength);
}
