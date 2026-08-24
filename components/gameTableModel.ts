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
export const SIDE_SECTION_W = 130;

// PASSA and GIOCA are square: they read as two keys either side of the hand
// rather than as two columns of it, which is what a card-height button was.
const ACTION_BTN = 56;
/** A comfortable thumb, in physical points — never `48 * scale`. */
export const ACTION_BTN_FLOOR = 48;
/** Hand to button, and button to the edge of the play area. */
export const HAND_ZONE_GAP = 26;

export function actionBtnSize(scale: number): number {
  return Math.max(ACTION_BTN_FLOOR, ACTION_BTN * scale);
}

// ─── The table's own pads ─────────────────────────────────────────────────────
//
// The felt runs edge to edge: there is no frame, and the lamp is what shapes
// it. What the table does keep are its own pads, which scale with it and are
// floored by whatever safe area the device actually reports.

const PAD_TOP = 13;
const PAD_BOTTOM = 13;
const PAD_RIGHT = 17;
/** From the rail, or the safe edge, to the first thing drawn over the felt. */
const PAD_INNER = 10;

/** A HUD chip's own height. The chrome over the felt is two of these. */
export function CHIP_H(scale: number): number {
  return 23 * scale;
}
/**
 * Headroom above the hand row's own cards — enough to clear a selected card's
 * lift (SELECT_LIFT, components/table/hand.tsx) without the row above it
 * shifting. hand.tsx reuses this same number as its scrollable fallback's own
 * top clearance, so the two cannot drift apart.
 */
export const HAND_ROW_HEADROOM = 16;

// ─── The hand's own band ──────────────────────────────────────────────────────
//
// The hand meets the device's bottom edge and is cropped by it, which buys the
// table height while making the cards bigger rather than smaller. The crop
// costs nothing: a card's index is at its top-left, and only the redundant
// upside-down copy at the foot is lost.

/**
 * How much of a hand card falls past the bottom edge. The prototype pushes the
 * hand `26 * s` below the safe line against a `90 * s` card, and that is what
 * takes the upside-down index at the card's foot out of the picture — a
 * shallower crop leaves it legible and the hand reads as floating rather than
 * as held.
 */
export const HAND_CROP = 26 / 90;

/**
 * The part of a hand card the player actually sees — which is also how tall
 * PASSA and GIOCA are, so the row still reads as one band. They are never
 * cropped themselves: they sit on the safe line, clear of the home indicator.
 */
export function handVisibleH(cardH: number): number {
  return cardH * (1 - HAND_CROP);
}

/**
 * The hand zone's own height. It runs to the device bottom rather than
 * stopping at the felt, so it carries the bottom safe pad itself: the buttons
 * sit above that line and the cards run past it.
 */
export function HAND_ZONE_H(cardH: number, bottomPad: number): number {
  return handVisibleH(cardH) + bottomPad + HAND_ROW_HEADROOM;
}

// ─── Width budgets ────────────────────────────────────────────────────────────
//
// Every arc takes a share of the table, never all the room it can reach. A
// hand of three does not stretch across the felt to fill it, and a thirteen-
// card run compresses and stops rather than pushing the seats off the edge.

/**
 * The hand's share. The span the hand fills and then compresses inside, so it
 * is the same width whether the player holds five cards or twenty-one. Only
 * the finger floor (`MIN_READABLE_STEP`, components/handLayout.ts) can push a
 * hand past it, and past `handAvailW` the row scrolls.
 */
export const HAND_WIDTH_SHARE = 0.56;
/**
 * The field's share of the same width, bounded by what the seats leave it.
 * The prototype's own `layout()` is the authority for it and computes
 * `tb.width * .55`; #193's "45%" is a misquote of that line, not a target.
 */
export const FIELD_WIDTH_SHARE = 0.55;

// ─── Card jitter ──────────────────────────────────────────────────────────────

/**
 * Cards thrown onto a table do not land square, so a combination keeps a small
 * jitter on top of the arc it lands on. The bound stays small: past a few
 * degrees the overlap stops reading as one combination.
 */
export const COMBO_MAX_TILT = 4.5;

/**
 * A card's own jitter (deg), derived from its id so the same combination looks
 * the same on every client and in every frame of its throw.
 */
export function cardTilt(id: string, maxTilt: number): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return ((Math.abs(hash) % 200) / 100 - 1) * maxTilt;
}

// ─── Seating ──────────────────────────────────────────────────────────────────

export type FlyDirection = "top" | "bottom" | "left" | "right";
export type OpponentSide = "top" | "left" | "right";

/**
 * Backs drawn in an opponent's fan. Not legibility: the step barely moves with
 * the count, because `fitSpread` takes the smaller of its width and rise
 * bounds and the width one keeps growing until about nineteen backs. What each
 * extra back past this many is, is another third-of-a-card sliver of the same
 * block carrying its own SVG subtree, re-rendered on every `game:state` — and
 * the seat's count badge is what carries the number.
 *
 * Here rather than beside the fan that draws it: `tests/e2e/seatFans.spec.ts`
 * is what proves the cap, and it cannot import the fan, which pulls in
 * react-native. A second copy in the spec would hold the same number and never
 * disagree with it.
 */
export const FAN_DRAWN_CARDS: Record<OpponentSide, number> = { top: 7, left: 5, right: 5 };

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

// ─── The lamp ─────────────────────────────────────────────────────────────────

export interface LightPosition {
  /** Fractions of the felt box, not pixels. */
  x: number;
  y: number;
}

/**
 * Where the lamp hangs when a given seat is on move, so half the table falls
 * into shadow when it is not your turn. Just off the edge on that seat's own
 * side: a lamp centred on a seat lights the seat rather than the table it is
 * leaning over.
 */
export function lightPosition(dir: FlyDirection): LightPosition {
  switch (dir) {
    case "bottom": return { x: 0.5, y: 0.98 };
    case "top":    return { x: 0.5, y: 0.02 };
    case "left":   return { x: 0.02, y: 0.48 };
    case "right":  return { x: 0.98, y: 0.48 };
  }
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

/**
 * The short edge the table is laid out in: the window's, minus what the device
 * keeps for a cutout, a home indicator or a status bar. `cardScale` sizes every
 * card and touch target from it, so measuring the raw window sizes them for
 * room the table does not have — on a notched phone in landscape that is 21pt
 * of height and 118pt of width, while a browser reporting no insets is
 * unaffected.
 */
export function tableShortEdge(opts: { width: number; height: number; insets: EdgeInsets }): number {
  const { insets } = opts;
  return Math.min(opts.width - insets.left - insets.right, opts.height - insets.top - insets.bottom);
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
  /** From an edge to the first thing drawn over the felt. */
  pad: number;
  tableLeft: number;
  tableTop: number;
  tableRight: number;
  tableBottom: number;
  /** Width available to the hand row between the PASSA and GIOCA buttons. */
  handAvailW: number;
  /** …and the share of it the hand aims at — see HAND_WIDTH_SHARE. */
  handRoomW: number;
  /** Width the field's arc may take, bounded by what the side seats leave. */
  fieldRoomW: number;
}

/**
 * The box the table's contents lay out in. Not the felt — the felt is the
 * whole screen — but everything drawn over it: the rail eats the left edge,
 * the chips and the seats sit inside the pads, and the hand runs past the
 * bottom. `tableRight` and `tableBottom` are distances from the right and
 * bottom edges, matching the absolutely-positioned style props they feed.
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
  const tableTop = Math.max(PAD_TOP * opts.scale, topPad);
  const tableRight = Math.max(PAD_RIGHT * opts.scale, rightPad);
  const tableBottom = Math.max(PAD_BOTTOM * opts.scale, bottomPad);
  const tableW = opts.width - tableLeft - tableRight;
  const handAvailW = tableW - (actionBtnSize(opts.scale) + HAND_ZONE_GAP * opts.scale) * 2;

  return {
    topPad,
    bottomPad,
    leftPad,
    rightPad,
    rail,
    pad: PAD_INNER * opts.scale,
    tableLeft,
    tableTop,
    tableRight,
    tableBottom,
    handAvailW,
    handRoomW: Math.min(handAvailW, opts.width * HAND_WIDTH_SHARE),
    fieldRoomW: Math.min(tableW - SIDE_SECTION_W * 2, opts.width * FIELD_WIDTH_SHARE),
  };
}

/**
 * Top edge the notification banner may start at without covering the table's
 * own chips — which carry the combination on the felt and whose turn it is,
 * exactly the things an AFK or takeover notice is explaining.
 *
 * Landscape is the proxy for "the table is up": it is the only orientation the
 * table runs in, and on a menu screen in landscape the band the banner steps
 * over is empty, so it costs nothing there.
 */
export function notificationTopOffset(opts: {
  topPad: number;
  landscape: boolean;
  /** The table's own scale — the chips are sized from it. */
  scale: number;
}): number {
  if (!opts.landscape) return opts.topPad;
  const chipTop = Math.max(PAD_TOP * opts.scale, opts.topPad);
  return chipTop + CHIP_H(opts.scale) + PAD_INNER * opts.scale;
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
