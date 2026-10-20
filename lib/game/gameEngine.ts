import type { BotPersonalityId } from "./botPersonalities.ts";

export type Suit = "hearts" | "diamonds" | "clubs" | "spades";

export type Rank =
  | "3"
  | "4"
  | "5"
  | "6"
  | "7"
  | "8"
  | "9"
  | "10"
  | "J"
  | "Q"
  | "K"
  | "A"
  | "2"
  | "joker_bw"
  | "joker_colored";

export interface Card {
  id: string;
  suit: Suit | null;
  rank: Rank;
  isJoker: boolean;
}

export type CombinationType =
  | "single"
  | "pair"
  | "triple"
  | "straight"
  | "bomb"
  | "royal_straight";

export interface Combination {
  type: CombinationType;
  cards: Card[];
  strength: number;
}

export type GameMode = "free_for_all" | "teams";
export type PlayerType = "human" | "bot";
export type BotDifficulty = "easy" | "medium" | "hard";

export interface Player {
  id: string;
  name: string;
  hand: Card[];
  type: PlayerType;
  /** bot seats only. Absent means the default personality (lib/game/botPersonalities.ts). */
  personality?: BotPersonalityId;
  team?: "A" | "B";
  finishPosition?: number;
}

export interface ExchangePhase {
  active: boolean;
  winnerIdx: number;
  loserIdx: number;
  /** Absent on the two-Jokers exception, where no card moves. */
  cardFromLoser?: Card;
  /**
   * What the winner handed back. Absent until they choose, so it arrives in
   * the same state that closes the phase. Online this is the only record of
   * the return leg — every other seat's hand is sanitized out of the view.
   */
  cardToLoser?: Card;
  twoJokerException: boolean;
  /**
   * When the phase closed, in epoch ms — how long `cardToLoser` stays public.
   * Written by the server and never sent to a client; the engine must not write
   * it, or a clock inside the rules makes every engine test a different game.
   */
  settledAt?: number;
}

export interface StartReason {
  type: "start_card" | "lost_round" | "won_no_exchange";
  card?: Card;
  playerIdx: number;
}

export interface GameState {
  players: Player[];
  currentTurnIndex: number;
  lastPlayedCombination: Combination | null;
  /**
   * Who made the play on the table. `processPass` clears the combination when a
   * trick closes but leaves this naming that trick's winner, so it answers "who
   * holds the trick" only while `lastPlayedCombination` is set.
   */
  lastPlayedBy: number;
  passCount: number;
  gameMode: GameMode;
  trickWinner: number | null;
  roundOver: boolean;
  finishingOrder: string[];
  firstPlayMade: boolean;
  startCard?: Card;
  startReason?: StartReason;
  exchangePhase?: ExchangePhase;
  /**
   * How many cards of each rank have been played this round, indexed by
   * `getRankStrength`. Public information — every seat watched them land — so
   * `sanitizeStateForPlayer` passes it through untouched.
   *
   * Optional because `GameState` is persisted as jsonb: a round in flight across
   * a deploy rehydrates without it, and a bot reading an absent tally must play
   * exactly as it did before the tally existed.
   */
  playedRanks?: number[];
}

const RANK_ORDER: Rank[] = [
  "3", "4", "5", "6", "7", "8", "9", "10",
  "J", "Q", "K", "A", "2", "joker_bw", "joker_colored",
];

export const RANK_SLOTS = RANK_ORDER.length;

export function getRankStrength(rank: Rank): number {
  return RANK_ORDER.indexOf(rank);
}

/** How many of each rank a full deck holds, indexed by `getRankStrength`. */
export const DECK_BY_STRENGTH: readonly number[] = RANK_ORDER.map((rank) =>
  rank === "joker_bw" || rank === "joker_colored" ? 1 : 4
);

export const emptyRankTally = (): number[] => new Array<number>(RANK_SLOTS).fill(0);

export function cardStrength(card: Card): number {
  return getRankStrength(card.rank);
}

export function getStraightFaceValue(rank: Rank, aceAsHigh: boolean): number | null {
  if (rank === "joker_bw" || rank === "joker_colored") return null;
  if (rank === "A") return aceAsHigh ? 14 : 1;
  const map: Partial<Record<Rank, number>> = {
    "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7,
    "8": 8, "9": 9, "10": 10, "J": 11, "Q": 12, "K": 13,
  };
  return map[rank] ?? null;
}

// A straight is 5..13 cards. The rules impose no maximum beyond the 13
// distinct straight positions available (the Ace picks one end, never both).
export const STRAIGHT_MIN_LEN = 5;
export const STRAIGHT_MAX_LEN = 13;

// Jokers are never part of a straight, so there is no joker substitution here:
// the face values must be exactly `totalLen` strictly consecutive integers.
function isConsecutiveRanks(faceValues: number[], totalLen: number): boolean {
  if (faceValues.length !== totalLen) return false;
  const sorted = [...faceValues].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] !== sorted[i - 1] + 1) return false;
  }
  return true;
}

function isStraight(cards: Card[]): boolean {
  if (cards.length < STRAIGHT_MIN_LEN) return false;
  if (cards.length > STRAIGHT_MAX_LEN) return false;
  if (cards.some((c) => c.isJoker)) return false;

  for (const aceAsHigh of [false, true]) {
    const faceValues = cards
      .map((c) => getStraightFaceValue(c.rank, aceAsHigh))
      .filter((v): v is number => v !== null);
    if (isConsecutiveRanks(faceValues, cards.length)) return true;
  }
  return false;
}

function getStraightStrength(cards: Card[]): number {
  if (cards.some((c) => c.isJoker)) return 0;

  for (const aceAsHigh of [true, false]) {
    const faceValues = cards
      .map((c) => getStraightFaceValue(c.rank, aceAsHigh))
      .filter((v): v is number => v !== null);
    if (!isConsecutiveRanks(faceValues, cards.length)) continue;

    if (faceValues.length === 0) return 0;
    const sorted = [...faceValues].sort((a, b) => a - b);
    return sorted[sorted.length - 1];
  }
  return 0;
}

function isBomb(cards: Card[]): boolean {
  if (cards.length !== 4) return false;
  if (cards.some((c) => c.isJoker)) return false;
  const rank = cards[0].rank;
  return cards.every((c) => c.rank === rank);
}

function isRoyalStraight(cards: Card[]): boolean {
  if (cards.length < STRAIGHT_MIN_LEN) return false;
  if (cards.some((c) => c.isJoker)) return false;
  const suit = cards[0].suit;
  if (!suit) return false;
  return cards.every((c) => c.suit === suit) && isStraight(cards);
}

export function createDeck(): Card[] {
  const suits: Suit[] = ["hearts", "diamonds", "clubs", "spades"];
  const ranks: Rank[] = [
    "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A",
  ];
  const cards: Card[] = [];
  for (const suit of suits) {
    for (const rank of ranks) {
      cards.push({ id: `${rank}_${suit}`, suit, rank, isJoker: false });
    }
  }
  cards.push({ id: "joker_bw", suit: null, rank: "joker_bw", isJoker: true });
  cards.push({ id: "joker_colored", suit: null, rank: "joker_colored", isJoker: true });
  return cards;
}

// This module is imported by the React Native client as well as by the server,
// so it must not `import` node:crypto at module scope — Metro would try to
// bundle it. `globalThis.crypto.getRandomValues` exists in Node 18+ and in
// React Native / Hermes; Math.random is only ever the last-resort fallback.
export type RandomSource = { getRandomValues(array: Uint32Array): Uint32Array };

export const cryptoRandom: RandomSource = {
  getRandomValues(array) {
    const c = (globalThis as { crypto?: Partial<RandomSource> }).crypto;
    if (c && typeof c.getRandomValues === "function") return c.getRandomValues(array);
    for (let i = 0; i < array.length; i++) array[i] = Math.floor(Math.random() * 0x100000000);
    return array;
  },
};

/**
 * Unbiased random integer in [0, maxExclusive).
 * Rejection sampling over a uint32: a plain `% maxExclusive` is biased whenever
 * maxExclusive does not divide 2^32 evenly.
 */
function randomBelow(maxExclusive: number, source: RandomSource): number {
  if (maxExclusive <= 1) return 0;
  const range = 0x100000000;
  const limit = range - (range % maxExclusive); // largest unbiased multiple
  const buf = new Uint32Array(1);
  let value: number;
  do {
    source.getRandomValues(buf);
    value = buf[0];
  } while (value >= limit);
  return value % maxExclusive;
}

export function shuffleDeck(deck: Card[], random: RandomSource = cryptoRandom): Card[] {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = randomBelow(i + 1, random);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export const HEADS_UP_HAND = 14;

/**
 * Deals cards one at a time, round-robin from `firstSeat`. 4 players =
 * 14/14/13/13, 3 players = 18 each — the whole deck, so the 3♠ and both
 * Jokers are always in play. The two extra cards at 4 players land on
 * `firstSeat` and the seat after it, so rotating it between rounds is what
 * stops the same seats holding the bigger hand for the whole match
 * (docs/GAME-RULES.md §3, the dealer's rotation).
 *
 * 2 players is the one seat count that does NOT deal the whole deck: dealing
 * everything leaves each player able to deduce the other's exact hand by
 * elimination, so 14 cards go to each (28 of 54) and the remaining 26 are
 * left face down and unused for the round. It is the four-player hand size,
 * which is what makes a duel play like the game rather than like a
 * bomb-heavy variant of it (docs/GAME-RULES.md §3, decided in `docs/GAME-RULES.md` § Decisions).
 */
export function dealCards(
  playerCount: number,
  firstSeat = 0,
  random: RandomSource = cryptoRandom
): { hands: Card[][]; excluded: Card[] } {
  if (playerCount < 1) return { hands: [], excluded: [] };
  const deck = shuffleDeck(createDeck(), random);
  const hands: Card[][] = Array.from({ length: playerCount }, () => []);
  const start = ((firstSeat % playerCount) + playerCount) % playerCount;

  const handSize = playerCount === 2 ? HEADS_UP_HAND : Math.ceil(deck.length / playerCount);
  const dealt = Math.min(deck.length, handSize * playerCount);
  for (let i = 0; i < dealt; i++) {
    hands[(start + i) % playerCount].push(deck[i]);
  }
  return { hands, excluded: deck.slice(dealt) };
}

/**
 * The fewest cards `dealCards` ever leaves any seat at `playerCount`, before
 * a card is played. Two seats get the fixed heads-up hand size in full — that
 * branch never round-robins the whole deck — so the minimum is the deal size
 * itself; every other seat count deals the whole deck round-robin, so the
 * minimum is what an even split loses to its own remainder.
 */
export function freshHandFloor(playerCount: number, deckLength = createDeck().length): number {
  if (playerCount < 1) return 0;
  return playerCount === 2 ? HEADS_UP_HAND : Math.floor(deckLength / playerCount);
}

export function sortHand(hand: Card[]): Card[] {
  return [...hand].sort((a, b) => {
    const diff = cardStrength(a) - cardStrength(b);
    if (diff !== 0) return diff;
    const suitOrder: (Suit | null)[] = ["clubs", "diamonds", "hearts", "spades", null];
    return suitOrder.indexOf(a.suit) - suitOrder.indexOf(b.suit);
  });
}

/**
 * The holder of the 3♠ opens the first round and must include it in the play.
 * At 3 and 4 players the whole deck is dealt, so the 3♠ is always in
 * somebody's hand. At 2 players it can land in the undealt pile (§ dealCards)
 * — the "lowest card held by anyone" fallback below is what actually opens
 * those rounds, not just a defensive backstop.
 *
 * The synthesised-3♠ fallback below it exists only so a fully empty deal can
 * never crash.
 */
const OPENING_SUIT_ORDER: Card["suit"][] = ["clubs", "diamonds", "hearts", "spades"];

export function findStartingPlayer(
  players: Player[]
): { playerIdx: number; startCard: Card } {
  for (let i = 0; i < players.length; i++) {
    const card = players[i].hand.find(
      (c) => c.rank === "3" && c.suit === "spades"
    );
    if (card) return { playerIdx: i, startCard: card };
  }

  // Defensive fallback: lowest card held by any player.
  let bestIdx = -1;
  let bestCard: Card | undefined;
  for (let i = 0; i < players.length; i++) {
    for (const card of players[i].hand) {
      if (
        !bestCard ||
        cardStrength(card) < cardStrength(bestCard) ||
        (cardStrength(card) === cardStrength(bestCard) &&
          OPENING_SUIT_ORDER.indexOf(card.suit) < OPENING_SUIT_ORDER.indexOf(bestCard.suit))
      ) {
        bestCard = card;
        bestIdx = i;
      }
    }
  }
  if (bestCard) return { playerIdx: bestIdx, startCard: bestCard };

  // Unreachable unless every hand is empty.
  return {
    playerIdx: 0,
    startCard: { id: "3_spades", suit: "spades", rank: "3", isJoker: false },
  };
}

export function getCombinationType(cards: Card[]): CombinationType | null {
  if (cards.length === 0) return null;

  if (isBomb(cards)) return "bomb";

  // Jokers can ONLY be played as single cards — never in multi-card combos
  if (cards.length === 1) return "single";

  if (cards.some((c) => c.isJoker)) return null;

  const nonJokers = cards;

  if (cards.length === 2) {
    if (nonJokers[0].rank === nonJokers[1].rank) return "pair";
    return null;
  }

  if (cards.length === 3) {
    const nonJokerRanks = new Set(nonJokers.map((c) => c.rank));
    if (nonJokerRanks.size === 1) return "triple";
    return null;
  }

  if (cards.length === 4) {
    return null;
  }

  if (isRoyalStraight(cards)) return "royal_straight";
  if (isStraight(cards)) return "straight";
  return null;
}

export function getCombinationStrength(combination: Combination): number {
  const cards = combination.cards;
  switch (combination.type) {
    case "single":
      return cardStrength(cards[0]);
    // Pairs, triples and bombs are same-rank by construction and can never
    // contain a joker (jokers are singles only), so any card gives the rank.
    case "pair":
    case "triple":
      return cardStrength(cards[0]);
    case "straight":
    case "royal_straight":
      return getStraightStrength(cards);
    case "bomb":
      return cardStrength(cards[0]);
  }
}

export function buildCombination(cards: Card[]): Combination | null {
  const type = getCombinationType(cards);
  if (!type) return null;
  const combo: Combination = { type, cards, strength: 0 };
  combo.strength = getCombinationStrength(combo);
  return combo;
}

/** Why the table refuses a combination: what it fails to beat. */
export type BeatRefusal = "royalUnbeatable" | "bombOnly" | "wrongType" | "wrongLength" | "tooLow";

/** Why a play is refused, in the order `checkPlay` asks. */
export type PlayRefusal =
  | "exchangeOpen"
  | "notHeld"
  | "notACombination"
  | "needsStartCard"
  | BeatRefusal;

/** The refusals a selection itself earns: cards drawn from the hand are always held. */
export type SelectionRefusal = Exclude<PlayRefusal, "exchangeOpen" | "notHeld">;

export type PassRefusal = "exchangeOpen" | "mustLead";

function beatRefusal(candidate: Combination, lastPlayed: Combination | null): BeatRefusal | null {
  if (!lastPlayed) return null;
  const higher = candidate.strength > lastPlayed.strength ? null : "tooLow";

  if (candidate.type === "royal_straight") {
    if (lastPlayed.type !== "royal_straight") return null;
    return candidate.cards.length === lastPlayed.cards.length ? higher : "wrongLength";
  }

  if (candidate.type === "bomb") {
    if (lastPlayed.type === "royal_straight") return "royalUnbeatable";
    return lastPlayed.type === "bomb" ? higher : null;
  }

  if (lastPlayed.type === "royal_straight") return "royalUnbeatable";
  if (lastPlayed.type === "bomb") return "bombOnly";
  if (candidate.type !== lastPlayed.type) return "wrongType";
  if (candidate.cards.length !== lastPlayed.cards.length) return "wrongLength";
  return higher;
}

export function canPlay(
  candidate: Combination,
  lastPlayed: Combination | null
): boolean {
  return beatRefusal(candidate, lastPlayed) === null;
}

/**
 * Whether `seat` may play `cardIds` now, and the combination its own cards form
 * if so. Turn ownership is `applyMove`'s: here `seat` names whose hand to read,
 * not a claim that it is on move. A repeated id is the one card it names.
 */
export function checkPlay(
  state: GameState,
  seat: number,
  cardIds: string[]
): PlayCheck {
  if (state.exchangePhase?.active) return { ok: false, code: "exchangeOpen" };
  const hand = state.players[seat]?.hand ?? [];
  const wanted = new Set(cardIds);
  const cards = hand.filter((card) => wanted.has(card.id));
  if (cards.length !== wanted.size) return { ok: false, code: "notHeld" };
  return checkSelection(cards, state);
}

export type PlayCheck = { ok: true; combo: Combination } | { ok: false; code: PlayRefusal };

export type SelectionCheck =
  | { ok: true; combo: Combination }
  | { ok: false; code: SelectionRefusal };

/** `checkPlay` past the seat: whether these cards, already known held, answer this table. */
export function checkSelection(
  cards: Card[],
  table: Pick<GameState, "lastPlayedCombination" | "firstPlayMade" | "startCard">
): SelectionCheck {
  const combo = buildCombination(cards);
  if (!combo) return { ok: false, code: "notACombination" };
  const startCard = table.firstPlayMade ? undefined : table.startCard;
  if (startCard && !cards.some((card) => card.id === startCard.id)) {
    return { ok: false, code: "needsStartCard" };
  }
  const refusal = beatRefusal(combo, table.lastPlayedCombination);
  return refusal ? { ok: false, code: refusal } : { ok: true, combo };
}

/** Whether the seat on move may pass now. Turn ownership is `applyMove`'s, as in `checkPlay`. */
export function checkPass(state: GameState): { ok: true } | { ok: false; code: PassRefusal } {
  if (state.exchangePhase?.active) return { ok: false, code: "exchangeOpen" };
  if (state.lastPlayedCombination === null) return { ok: false, code: "mustLead" };
  return { ok: true };
}

export type Move =
  | { kind: "play"; cardIds: string[] }
  | { kind: "pass" }
  | { kind: "giveback"; cardId: string };

export type AppliedMove =
  | { kind: "play"; seat: number; combo: Combination }
  | { kind: "pass"; seat: number }
  | { kind: "giveback"; seat: number; card: Card };

/** Why a move is refused, in the order `applyMove` asks. */
export type MoveRefusal =
  | "roundOver"
  | "exchangeOpen"
  | "noExchange"
  | "notExchangeWinner"
  | "notYourTurn"
  | "notHeld"
  | SelectionRefusal
  | "mustLead"
  | "notGiveable";

/** A refusal leaves the state untouched. */
export type MoveResult =
  | { ok: true; state: GameState; move: AppliedMove }
  | { ok: false; code: MoveRefusal };

/** Who must act now: the exchange winner while an exchange is open, else the turn holder. */
export function actingSeat(state: GameState): number {
  return state.exchangePhase?.active ? state.exchangePhase.winnerIdx : state.currentTurnIndex;
}

/** `seat` is the transport's claim of who is acting; it is checked here, never trusted. */
export function applyMove(state: GameState, seat: number, move: Move): MoveResult {
  if (state.roundOver) return { ok: false, code: "roundOver" };
  const exchange = state.exchangePhase?.active ? state.exchangePhase : null;
  if (move.kind === "giveback") {
    if (!exchange) return { ok: false, code: "noExchange" };
    if (seat !== exchange.winnerIdx) return { ok: false, code: "notExchangeWinner" };
  } else if (exchange) {
    return { ok: false, code: "exchangeOpen" };
  }
  if (seat !== actingSeat(state)) return { ok: false, code: "notYourTurn" };

  switch (move.kind) {
    case "play": {
      const check = checkPlay(state, seat, move.cardIds);
      if (!check.ok) return check;
      return { ok: true, state: processPlay(state, check.combo), move: { kind: "play", seat, combo: check.combo } };
    }
    case "pass": {
      const check = checkPass(state);
      if (!check.ok) return check;
      return { ok: true, state: processPass(state), move: { kind: "pass", seat } };
    }
    case "giveback": {
      const hand = state.players[seat]?.hand ?? [];
      const card = hand.find((held) => held.id === move.cardId);
      if (!card) return { ok: false, code: "notHeld" };
      const offered = getValidGivebackCards(hand, state.exchangePhase?.cardFromLoser?.id);
      if (!offered.some((c) => c.id === card.id)) return { ok: false, code: "notGiveable" };
      return { ok: true, state: processExchangeChoice(state, card.id), move: { kind: "giveback", seat, card } };
    }
  }
}

// ─── Complete, correct valid-play enumeration ─────────────────────────────────
// Handles any hand size by enumerating by combination structure,
// not bitmask, so no hand size is a special case.

export function getAllValidPlays(
  hand: Card[],
  lastPlayed: Combination | null,
  isNewTrick: boolean,
  requireCard?: Card
): Combination[] {
  const plays: Combination[] = [];
  const seen = new Set<string>();

  // `canPlay` discriminates on type, length and strength and on nothing else,
  // and the strength chain is suit-blind, so entries agreeing on all three are
  // interchangeable for legality. Deduping here rather than per arm is what
  // makes that hold for the arms not yet written.
  function tryAdd(selected: Card[]): void {
    if (!selected.length) return;
    if (requireCard && !selected.some((c) => c.id === requireCard.id)) return;
    const combo = buildCombination(selected);
    if (!combo || !canPlay(combo, isNewTrick ? null : lastPlayed)) return;
    const key = `${combo.type}:${combo.cards.length}:${combo.strength}`;
    if (seen.has(key)) return;
    seen.add(key);
    plays.push(combo);
  }

  const nj = hand.filter((c) => !c.isJoker);

  const byRank = new Map<string, Card[]>();
  for (const c of nj) {
    const g = byRank.get(c.rank) ?? [];
    g.push(c);
    byRank.set(c.rank, g);
  }

  for (const c of hand) tryAdd([c]);

  for (const group of byRank.values()) {
    for (let i = 0; i < group.length; i++)
      for (let j = i + 1; j < group.length; j++)
        tryAdd([group[i], group[j]]);
  }

  for (const group of byRank.values()) {
    for (let i = 0; i < group.length; i++)
      for (let j = i + 1; j < group.length; j++)
        for (let k = j + 1; k < group.length; k++)
          tryAdd([group[i], group[j], group[k]]);
  }

  for (const group of byRank.values()) {
    if (group.length >= 4) tryAdd(group.slice(0, 4));
  }

  // ── Straights ───────────────────────────────────────────────────────────
  // Enumerate by straight position, not by slicing a sorted array: a duplicate
  // rank in the span would poison every window containing it, hiding legal
  // straights such as 3-4-5-6-7 within 3,4,5,5,6,7.
  //
  // Bucketed by straight face value 1..14 (Ace fills both 1 and 14; a run caps
  // at 13 so it cannot use the Ace twice). One card per value is enough for a
  // plain straight — but an all-one-suit pick would classify as ROYAL, so a
  // mixed-suit card is preferred. Royal straights are enumerated per suit.
  for (const groups of enumerateStraightWindows(nj)) {
    tryAdd(selectStraightCards(groups, requireCard));
  }
  for (const suit of STRAIGHT_SUITS) {
    const suited = nj.filter((c) => c.suit === suit);
    if (suited.length < STRAIGHT_MIN_LEN) continue;
    for (const groups of enumerateStraightWindows(suited)) {
      tryAdd(selectStraightCards(groups, requireCard));
    }
  }

  return plays;
}

const STRAIGHT_SUITS: Suit[] = ["hearts", "diamonds", "clubs", "spades"];
const STRAIGHT_MIN_VALUE = 1; // Ace low
const STRAIGHT_MAX_VALUE = 14; // Ace high

/**
 * Buckets non-joker cards by straight face value. The Ace is filed under both
 * 1 (low) and 14 (high) so both orientations are reachable from one map.
 */
function bucketByStraightValue(cards: Card[]): Map<number, Card[]> {
  const byValue = new Map<number, Card[]>();
  const push = (value: number, card: Card) => {
    const group = byValue.get(value);
    if (group) group.push(card);
    else byValue.set(value, [card]);
  };
  for (const card of cards) {
    if (card.isJoker) continue;
    const low = getStraightFaceValue(card.rank, false);
    if (low !== null) push(low, card);
    if (card.rank === "A") push(STRAIGHT_MAX_VALUE, card);
  }
  return byValue;
}

/**
 * Every contiguous run of 5..13 straight positions that the given cards can
 * fill, yielded as the list of candidate cards per position.
 *
 * At most 14 starts x 9 lengths = 126 windows, so this stays far below a
 * millisecond even for the widest hand the deal produces.
 */
function* enumerateStraightWindows(cards: Card[]): Generator<Card[][]> {
  const byValue = bucketByStraightValue(cards);
  for (let start = STRAIGHT_MIN_VALUE; start <= STRAIGHT_MAX_VALUE; start++) {
    if (!byValue.has(start)) continue;
    const run: Card[][] = [];
    for (let value = start; value <= STRAIGHT_MAX_VALUE; value++) {
      const group = byValue.get(value);
      if (!group) break;
      run.push(group);
      if (run.length > STRAIGHT_MAX_LEN) break;
      if (run.length >= STRAIGHT_MIN_LEN) yield [...run];
    }
  }
}

/**
 * Picks one card per straight position. `requireCard` (the forced 3♠ opening)
 * wins its position outright. Otherwise a mixed-suit selection is preferred so
 * the play is a plain straight; the all-one-suit variants are produced by the
 * per-suit royal pass instead.
 */
function selectStraightCards(groups: Card[][], requireCard?: Card): Card[] {
  const picked = groups.map((group) => {
    if (requireCard) {
      const forced = group.find((c) => c.id === requireCard.id);
      if (forced) return forced;
    }
    return group[0];
  });

  const suit = picked[0].suit;
  if (picked.every((c) => c.suit === suit)) {
    for (let i = 0; i < groups.length; i++) {
      if (requireCard && picked[i].id === requireCard.id) continue;
      const alt = groups[i].find((c) => c.suit !== suit);
      if (alt) {
        picked[i] = alt;
        break;
      }
    }
  }
  return picked;
}

// ─── Game state processing ────────────────────────────────────────────────────

/**
 * Places the one seat still holding cards when the round ends
 * (docs/GAME-RULES.md §9) as last. Every seat must end up in `finishingOrder`: the
 * scoreboard awards from it and the stats writer records from it, so a missing
 * seat is a player who silently played no round. Mutates `state` — callers hold
 * a clone.
 */
function placeLastSeat(state: GameState): void {
  const last = state.players.find((p) => p.hand.length > 0 && p.finishPosition === undefined);
  if (!last) return;
  last.finishPosition = state.finishingOrder.length + 1;
  state.finishingOrder.push(last.id);
}

/**
 * The engine's own floor under a play. Every caller gates as well — the server
 * by seat, the offline context before it commits, and a bot play is legal by
 * construction — but a caller that forgot would otherwise strip cards a hand
 * never held and leave the state quietly wrong rather than loudly refused.
 *
 * Turn ownership is `applyMove`'s, which checks the transport's claim of the
 * acting seat against `actingSeat`. What this checks is what `checkPlay` checks
 * for the seat on move, and that the shape it claims is the shape its own cards
 * actually form.
 *
 * `combination.type`/`.strength` are re-derived from `.cards` rather than
 * trusted as given: a caller could otherwise claim any shape for any cards,
 * and `canPlay` compares only the claim.
 */
function assertPlayable(state: GameState, combination: Combination): void {
  const player = state.players[state.currentTurnIndex];
  if (!player) {
    throw new Error(`no player on seat ${state.currentTurnIndex}`);
  }
  if (combination.cards.length === 0) {
    throw new Error(`${player.name} played nothing`);
  }
  const played = combination.cards.map((c) => c.id);
  // Membership alone passes `[7s,7s,7s,7s]` as a bomb: every id is held, once.
  if (new Set(played).size !== played.length) {
    throw new Error(`${player.name} played ${played.join(", ")}, which repeats a card`);
  }
  const check = checkPlay(state, state.currentTurnIndex, played);
  if (!check.ok) {
    throw new Error(refusalMessage(check.code, player, combination, state));
  }
  if (check.combo.type !== combination.type || check.combo.strength !== combination.strength) {
    throw new Error(`${played.join(", ")} is not a ${combination.type}`);
  }
}

function refusalMessage(
  code: PlayRefusal,
  player: Player,
  combination: Combination,
  state: GameState
): string {
  const played = combination.cards.map((c) => c.id);
  switch (code) {
    case "exchangeOpen":
      return `${player.name} cannot play while the exchange is open`;
    case "notHeld": {
      const held = new Set(player.hand.map((c) => c.id));
      return `${player.name} does not hold ${played.filter((id) => !held.has(id)).join(", ")}`;
    }
    case "notACombination":
      return `${played.join(", ")} is not a ${combination.type}`;
    case "needsStartCard":
      return `${player.name} must open with ${state.startCard!.id}`;
    default:
      return `${combination.type} of ${combination.cards.length} does not beat the table`;
  }
}

export function processPlay(state: GameState, combination: Combination): GameState {
  assertPlayable(state, combination);

  const newState = structuredClone(state);
  const player = newState.players[newState.currentTurnIndex];

  // Both paths route every play through here — the server online, the client
  // itself offline — so the tally is written once and cannot drift between them.
  const tally = newState.playedRanks ?? emptyRankTally();
  combination.cards.forEach((played) => {
    player.hand = player.hand.filter((c) => c.id !== played.id);
    tally[getRankStrength(played.rank)] += 1;
  });
  newState.playedRanks = tally;

  newState.lastPlayedCombination = combination;
  newState.lastPlayedBy = newState.currentTurnIndex;
  newState.passCount = 0;
  newState.firstPlayMade = true;

  if (player.hand.length === 0) {
    const position = newState.finishingOrder.length + 1;
    player.finishPosition = position;
    newState.finishingOrder.push(player.id);

    const activePlayers = newState.players.filter((p) => p.hand.length > 0);

    if (activePlayers.length <= 1) {
      placeLastSeat(newState);
      newState.roundOver = true;
      return newState;
    }
  }

  newState.currentTurnIndex = getNextActivePlayer(newState);
  return newState;
}

/**
 * Consecutive passes that close a trick: every OTHER player still holding
 * cards. A last player who has gone out is no longer among them, so every
 * remaining active player must be given a chance to answer — hence no −1
 * there. `lib/game/replay.ts` reads the same threshold to fold a stored log back
 * into a pile, which is why it is exported rather than inline.
 */
export function passesToCloseTrick(activeCount: number, lastPlayerStillActive: boolean): number {
  return Math.max(1, lastPlayerStillActive ? activeCount - 1 : activeCount);
}

export function processPass(state: GameState): GameState {
  // A player leading a new trick must play something — passing is not a legal
  // move for them. The engine is the server-authoritative path, so it refuses
  // here rather than relying on the UI. State is returned untouched.
  if (!checkPass(state).ok) return state;

  const newState = structuredClone(state);
  newState.passCount += 1;

  const activeCount = newState.players.filter((p) => p.hand.length > 0).length;
  const lastPlayer = newState.players[newState.lastPlayedBy];
  const passesNeeded = passesToCloseTrick(
    activeCount,
    !!lastPlayer && lastPlayer.hand.length > 0
  );

  if (newState.passCount >= passesNeeded) {
    newState.lastPlayedCombination = null;
    newState.passCount = 0;
    newState.trickWinner = newState.lastPlayedBy;

    const lastWinner = newState.players[newState.lastPlayedBy];
    if (lastWinner && lastWinner.hand.length > 0) {
      newState.currentTurnIndex = newState.lastPlayedBy;
    } else {
      newState.currentTurnIndex = getNextActivePlayer({
        ...newState,
        currentTurnIndex: newState.lastPlayedBy,
      });
    }
  } else {
    newState.trickWinner = null;
    newState.currentTurnIndex = getNextActivePlayer(newState);
  }

  return newState;
}

export function getNextActivePlayer(state: GameState): number {
  const total = state.players.length;
  let next = (state.currentTurnIndex - 1 + total) % total;
  let attempts = 0;
  while (state.players[next].hand.length === 0 && attempts < total) {
    next = (next - 1 + total) % total;
    attempts++;
  }
  return next;
}

export function canPlayerPlay(
  hand: Card[],
  lastPlayed: Combination | null,
  isNewTrick: boolean
): boolean {
  return getAllValidPlays(hand, lastPlayed, isNewTrick).length > 0;
}

export function getCardDisplayRank(rank: Rank): string {
  if (rank === "joker_colored") return "JKR";
  if (rank === "joker_bw") return "JKR";
  return rank;
}

export function getSuitSymbol(suit: Suit | null): string {
  if (!suit) return "";
  const symbols: Record<Suit, string> = {
    hearts: "♥",
    diamonds: "♦",
    clubs: "♣",
    spades: "♠",
  };
  return symbols[suit];
}

const EXCHANGE_VALID_RANKS: Rank[] = ["3","4","5","6","7","8","9","10"];

export function processExchangeChoice(state: GameState, cardId: string): GameState {
  if (!state.exchangePhase?.active) return state;
  const { winnerIdx, loserIdx } = state.exchangePhase;
  const newState = structuredClone(state);
  const winnerHand = newState.players[winnerIdx].hand;
  const cardIdx = winnerHand.findIndex((c) => c.id === cardId);
  if (cardIdx < 0) return state;
  const card = winnerHand[cardIdx];
  // Validate against the same list the UI offers, so the fallback below can
  // never leave the winner with no legal choice (which froze the table).
  const offered = getValidGivebackCards(winnerHand, state.exchangePhase.cardFromLoser?.id);
  if (!offered.some((c) => c.id === card.id)) {
    return state;
  }

  newState.players[winnerIdx].hand = winnerHand.filter((_, i) => i !== cardIdx);
  newState.players[loserIdx].hand = sortHand([...newState.players[loserIdx].hand, card]);
  newState.currentTurnIndex = loserIdx;
  newState.lastPlayedBy = loserIdx;
  newState.exchangePhase!.cardToLoser = card;
  newState.exchangePhase!.active = false;
  return newState;
}

/**
 * Cards the round winner may hand back to the loser.
 *
 * Any card ranked 3 through 10, other than the one just handed over — giving
 * that straight back is not an exchange (docs/GAME-RULES.md §10). A hand can hold
 * no card in 3-10 at all, and an empty result deadlocks the exchange behind an
 * undismissable overlay, so there the single lowest card is the giveback.
 */
/** The card a bot gives back: the weakest legal choice, or the lowest card in
 *  hand when nothing is in the 3-10 range. Never undefined for a non-empty hand. */
export function pickGivebackCard(hand: Card[], excludeCardId?: string): Card | undefined {
  return sortHand(getValidGivebackCards(hand, excludeCardId))[0];
}

export function getValidGivebackCards(hand: Card[], excludeCardId?: string): Card[] {
  const eligible = excludeCardId ? hand.filter((c) => c.id !== excludeCardId) : hand;
  const inRange = eligible.filter((c) => EXCHANGE_VALID_RANKS.includes(c.rank));
  if (inRange.length > 0) return inRange;
  if (eligible.length === 0) return [];
  return [sortHand(eligible)[0]];
}

/**
 * Whether a giveback set is the fallback rather than the ordinary rule — the
 * hand held nothing in 3-10, so the lowest card was offered instead. The
 * prompt names a different rule then, and the ranks that decide it stay here.
 */
export function givebackIsFallback(giveback: Card[]): boolean {
  return giveback.length > 0 && !giveback.some((c) => EXCHANGE_VALID_RANKS.includes(c.rank));
}

export function loserHasBothJokers(hand: Card[]): boolean {
  return (
    hand.some((c) => c.rank === "joker_colored") &&
    hand.some((c) => c.rank === "joker_bw")
  );
}

export function getBestCardFromHand(hand: Card[]): Card | undefined {
  if (hand.length === 0) return undefined;
  return [...hand].sort((a, b) => cardStrength(b) - cardStrength(a))[0];
}

export function getStartingPlayerAfterExchange(state: GameState): number {
  if (!state.exchangePhase) return state.currentTurnIndex;
  return state.exchangePhase.twoJokerException
    ? state.exchangePhase.winnerIdx
    : state.exchangePhase.loserIdx;
}

/**
 * Whether the round's opening play is still to come — the moment
 * `startReason` describes, and the only one it may be announced in.
 *
 * The turn index matching the opener does not answer this: `startReason` labels
 * the whole round and is never cleared, and the opener takes the lead again
 * every round they win. `firstPlayMade` does not either — only the very first
 * deal of a match starts it false; a round dealt after a lost round carries
 * it already true. What every deal empties and every play writes is the rank
 * tally, so an empty one is the state's own word for "nobody has played this
 * round yet". A round persisted before the tally existed has none, and reads as
 * past its opening: a missing announcement costs less than one over a live round.
 *
 * True during the round-winner's exchange choice only by accident of index —
 * `currentTurnIndex` still names the exchange's actor there, which for
 * `lost_round` differs from `startReason.playerIdx` and for `won_no_exchange`
 * (no exchange) already matches it. Shared with the server, which reads it to
 * grant the opener's first turn a longer AFK window (#830) — the same
 * condition, not a second one kept in step by hand.
 */
export function openingIsPending(state: {
  currentTurnIndex: number;
  roundOver: boolean;
  startReason?: { playerIdx: number };
  playedRanks?: number[];
}): boolean {
  if (state.roundOver || state.startReason === undefined) return false;
  if (state.currentTurnIndex !== state.startReason.playerIdx) return false;
  return state.playedRanks?.every((played) => played === 0) ?? false;
}

/**
 * Whether the round on the table is still as dealt: nobody has played into it.
 * An exchange round counts, though it carries `firstPlayMade` from the last one.
 */
export function roundUnplayed(state: {
  roundOver: boolean;
  firstPlayMade: boolean;
  playedRanks?: number[];
}): boolean {
  if (state.roundOver) return false;
  return !state.firstPlayMade || (state.playedRanks?.every((played) => played === 0) ?? false);
}

/** Teams is 2-v-2 and only 2-v-2 (docs/GAME-RULES.md §11). */
export const TEAMS_PLAYER_COUNT = 4;

export function modeFits(gameMode: GameMode, playerCount: number): boolean {
  return gameMode !== "teams" || playerCount === TEAMS_PLAYER_COUNT;
}

/**
 * The team a seat plays for. Partners sit opposite each other, so the teams
 * alternate around the table. Undefined for every match that is not a teams
 * match of exactly `TEAMS_PLAYER_COUNT` seats — an odd table has no 2-v-2 to
 * split into, and `resolveTeamMatch` would race a team against a single seat.
 */
export function teamForSeat(
  seat: number,
  playerCount: number,
  gameMode: GameMode
): "A" | "B" | undefined {
  if (gameMode !== "teams" || !modeFits(gameMode, playerCount)) return undefined;
  return seat % 2 === 0 ? "A" : "B";
}

/** The seat the next round deals from — one further round the table. */
export function nextDealFirstSeat(firstSeat: number, playerCount: number): number {
  if (playerCount < 1) return 0;
  return (firstSeat + 1) % playerCount;
}

/**
 * The seat the *next deal* starts from — `docs/GAME-RULES.md` § Decisions's "Rotating
 * the deal" decision: a finished match resets to seat 0, an unfinished one
 * rotates one seat further. `matchOver` is the state *before* this deal —
 * the just-ended round's own verdict, true when it was also the match's
 * last one.
 */
export function dealFirstSeatFor(
  matchOver: boolean,
  currentSeat: number,
  playerCount: number
): number {
  return matchOver ? 0 : nextDealFirstSeat(currentSeat, playerCount);
}

export interface SeatSetup {
  name: string;
  type: PlayerType;
  personality?: BotPersonalityId;
}

/** How a round opens: the 3♠ holder leads, or last round's winner and loser exchange (docs/GAME-RULES.md §10). */
export type Opening = { kind: "startCard" } | { kind: "exchange"; winnerSeat: number; loserSeat: number };

const START_CARD_OPENING: Opening = { kind: "startCard" };

export interface RoundOptions {
  firstSeat?: number;
  opening?: Opening;
  /**
   * The deal, when the caller already has one: a played round can only be rebuilt by handing its
   * cards back in (`tests/integration/soakLogReplays.test.ts`). `random` is ignored when it is given.
   */
  dealt?: Card[][];
  random?: RandomSource;
}

function checkedDeal(dealt: Card[][], seatCount: number): Card[][] {
  if (dealt.length !== seatCount) {
    throw new Error(`a deal for ${seatCount} seats has ${dealt.length} hands`);
  }
  const seen = new Set<string>();
  for (const hand of dealt) {
    for (const card of hand) {
      if (seen.has(card.id)) throw new Error(`card ${card.id} is dealt twice`);
      seen.add(card.id);
    }
  }
  return dealt;
}

function dealtRound(
  players: Player[],
  gameMode: GameMode
): Omit<GameState, "currentTurnIndex" | "lastPlayedBy" | "firstPlayMade"> {
  return {
    players,
    lastPlayedCombination: null,
    playedRanks: emptyRankTally(),
    passCount: 0,
    gameMode,
    trickWinner: null,
    roundOver: false,
    finishingOrder: [],
  };
}

function exchangeOpening(players: Player[], gameMode: GameMode, winnerIdx: number, loserIdx: number): GameState {
  const loser = players[loserIdx];
  if (loserHasBothJokers(loser.hand)) {
    return {
      ...dealtRound(players, gameMode),
      currentTurnIndex: winnerIdx,
      lastPlayedBy: winnerIdx,
      firstPlayMade: true,
      startReason: { type: "won_no_exchange", playerIdx: winnerIdx },
      exchangePhase: { active: false, winnerIdx, loserIdx, twoJokerException: true },
    };
  }

  // The hand was just dealt, so it is never empty — the only case the helper has no card to return.
  const cardFromLoser = getBestCardFromHand(loser.hand)!;
  loser.hand = loser.hand.filter((c) => c.id !== cardFromLoser.id);
  players[winnerIdx].hand = sortHand([...players[winnerIdx].hand, cardFromLoser]);

  return {
    ...dealtRound(players, gameMode),
    currentTurnIndex: winnerIdx,
    lastPlayedBy: winnerIdx,
    firstPlayMade: true,
    startReason: { type: "lost_round", playerIdx: loserIdx },
    exchangePhase: { active: true, winnerIdx, loserIdx, cardFromLoser, twoJokerException: false },
  };
}

/** The one deal, for every caller: seat `i` is `player_<i>`, on the team `teamForSeat` gives it. */
export function startRound(seats: readonly SeatSetup[], gameMode: GameMode, opts: RoundOptions = {}): GameState {
  const { firstSeat = 0, opening = START_CARD_OPENING, dealt, random } = opts;
  if (opening.kind === "exchange") {
    const { winnerSeat, loserSeat } = opening;
    const inRange = (seat: number) => Number.isInteger(seat) && seat >= 0 && seat < seats.length;
    if (!inRange(winnerSeat) || !inRange(loserSeat) || winnerSeat === loserSeat) {
      throw new Error(`no exchange between seats ${winnerSeat} and ${loserSeat} at ${seats.length} seats`);
    }
  }
  const hands = dealt ? checkedDeal(dealt, seats.length) : dealCards(seats.length, firstSeat, random).hands;

  const players: Player[] = seats.map((seat, i) => ({
    id: `player_${i}`,
    name: seat.name,
    hand: sortHand(hands[i]),
    type: seat.type,
    personality: seat.personality,
    team: teamForSeat(i, seats.length, gameMode),
    finishPosition: undefined,
  }));

  if (opening.kind === "exchange") {
    return exchangeOpening(players, gameMode, opening.winnerSeat, opening.loserSeat);
  }

  const { playerIdx: startIdx, startCard } = findStartingPlayer(players);
  return {
    ...dealtRound(players, gameMode),
    currentTurnIndex: startIdx,
    lastPlayedBy: startIdx,
    firstPlayMade: false,
    startCard,
    startReason: { type: "start_card", card: startCard, playerIdx: startIdx },
  };
}

/**
 * How the round after `finished` opens. Only a round every seat finished names a real loser: a match
 * ended by the vote leaves 2 of 4 ranked, and the 2nd finisher would be read as the loser
 * (docs/GAME-RULES.md § Decisions).
 */
export function openingAfter(finished: GameState): Opening {
  const order = finished.finishingOrder;
  if (order.length !== finished.players.length) return START_CARD_OPENING;
  const seatOf = (id: string) => finished.players.findIndex((p) => p.id === id);
  const winnerSeat = seatOf(order[0]);
  const loserSeat = seatOf(order[order.length - 1]);
  if (winnerSeat === loserSeat) return START_CARD_OPENING;
  return { kind: "exchange", winnerSeat, loserSeat };
}

/** The seats `state` was dealt to, to deal them again. */
export function seatsOf(state: GameState): SeatSetup[] {
  return state.players.map(({ name, type, personality }) => ({ name, type, personality }));
}

// ─── Match scoring ────────────────────────────────────────────────────────────
// Pure, side-effect-free primitives. The server owns the cumulative totals and
// the persistence; this module only says what a round is worth and whether the
// match is over.

/**
 * Match point targets, in escalation order. The match is won by the first
 * player to reach the current target; if two or more reach it in the same round
 * the target escalates to the next entry. 51 is the last one — a tie there is
 * a draw.
 */
export const MATCH_TARGETS: readonly number[] = [21, 31, 41, 51];

/** One turn clock online and offline, `docs/GAME-RULES.md` § Decisions. */
export const TURN_TIMEOUT_MS = 30_000;

/**
 * The escalation ladder for a table of `playerCount` seats.
 *
 * `scoreRound` pays N−1 down to 0, so a round is worth 6 points at four seats,
 * 3 at three and 1 at two — a flat ladder therefore made a 1-v-1 match a
 * 27-round affair nobody finished. Scaling by (N−1)/3 keeps every count in
 * the 8-12 round band a match should land in, and leaves the four-player
 * values docs/GAME-RULES.md §12 documents untouched.
 */
export function targetsFor(playerCount: number): number[] {
  return MATCH_TARGETS.map((t) => Math.round((t * (playerCount - 1)) / 3));
}

interface MatchResolution {
  /** Match winner(s). Empty when the target merely escalated. */
  winners: string[];
  /** The new target to keep playing to, or null when the match has ended. */
  newTarget: number | null;
  /** True when the match ended tied at the final target. */
  isDraw: boolean;
}

/**
 * Points for finishing at 0-based `finishIndex` of `playerCount` seats: N−1 for the first, down to 0
 * (docs/GAME-RULES.md §12).
 */
export function placementPoints(finishIndex: number, playerCount: number): number {
  return Math.max(playerCount - 1 - finishIndex, 0);
}

/** Points for one round, by id; players absent from `finishingOrder` are absent from the result. */
function scoreRound(
  finishingOrder: string[],
  playerCount: number
): Record<string, number> {
  const scores: Record<string, number> = {};
  finishingOrder.forEach((id, i) => {
    scores[id] = placementPoints(i, playerCount);
  });
  return scores;
}

function addPlacementPoints(
  cumulative: Record<string, number>,
  points: Record<string, number>
): Record<string, number> {
  const merged: Record<string, number> = { ...cumulative };
  for (const [id, earned] of Object.entries(points)) {
    merged[id] = (merged[id] ?? 0) + earned;
  }
  return merged;
}

function nextMatchTarget(target: number, playerCount: number): number | null {
  return targetsFor(playerCount).find((t) => t > target) ?? null;
}

/**
 * Nobody at the target → null; one → they win; several → the target escalates, or at the final
 * rung the top score wins, shared top scores being a draw.
 */
function resolveMatch(
  cumulative: Record<string, number>,
  target: number,
  playerCount: number
): MatchResolution | null {
  const reached = Object.entries(cumulative)
    .filter(([, points]) => points >= target)
    .map(([id]) => id);

  if (reached.length === 0) return null;
  if (reached.length === 1) {
    return { winners: reached, newTarget: null, isDraw: false };
  }

  const escalated = nextMatchTarget(target, playerCount);
  if (escalated !== null) {
    return { winners: [], newTarget: escalated, isDraw: false };
  }

  const best = Math.max(...reached.map((id) => cumulative[id]));
  const winners = reached.filter((id) => cumulative[id] === best);
  return { winners, newTarget: null, isDraw: winners.length > 1 };
}

/** Sums each key's points onto its team. Keys absent from `teamOfKey` count for nobody. */
export function aggregateTeamScores(
  cumulative: Record<string, number>,
  teamOfKey: Record<string, string>
): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const [key, team] of Object.entries(teamOfKey)) {
    totals[team] = (totals[team] ?? 0) + (cumulative[key] ?? 0);
  }
  return totals;
}

/**
 * GAME-RULES.md §11: the team races on its summed points; winners expand back to every member key
 * that may be named.
 */
function resolveTeamMatch(
  cumulative: Record<string, number>,
  teamOfKey: Record<string, string>,
  target: number,
  playerCount: number,
  nameable: (key: string) => boolean
): MatchResolution | null {
  // The ladder is the seated table's, not the two teams': a team races to the four-seat target on
  // the six points a four-seat round pays out.
  const resolution = resolveMatch(aggregateTeamScores(cumulative, teamOfKey), target, playerCount);
  if (!resolution) return null;

  const winningTeams = new Set(resolution.winners);
  return {
    ...resolution,
    winners: Object.entries(teamOfKey)
      .filter(([key, team]) => winningTeams.has(team) && nameable(key))
      .map(([key]) => key),
  };
}

/** How one seat scores. Offline every seat is its engine id; the server builds these from its roster. */
export interface SeatScoring {
  engineId: string;
  /** What the seat scores under; null: it scores for nobody. */
  key: string | null;
  team?: "A" | "B";
  /** May cross the target alone, or be named a winner. */
  crownable: boolean;
  /** A departed player's row: counts for the seat's team, never crownable. */
  frozenKey?: string;
}

export interface FoldRoundResult {
  /** What the round paid, by scoring key. */
  roundByKey: Record<string, number>;
  cumulative: Record<string, number>;
  /** What to play to next — escalated if this round tied at the old target. */
  target: number;
  over: boolean;
  winners: string[];
  isDraw: boolean;
}

/**
 * Folds a finished round into its match: awards the placement points, then escalates the target,
 * ends the match, or leaves it running. A `single` match ends here with no target involved — its
 * winner is whoever took the round, or in teams the team with more points, a tie being a draw
 * (docs/GAME-RULES.md §11, § Decisions).
 *
 * Every key accumulates. Only a key some seat lists as its crownable `key` may cross the target or be
 * named: frozen rows, a vacated `bot:<seat>` and a row nobody sits behind any more never are — the
 * disconnect policy of docs/GAME-RULES.md § Decisions.
 */
export function foldRound(
  round: { finishingOrder: string[]; playerCount: number; gameMode: GameMode; length: MatchLength },
  ledger: { cumulative: Record<string, number>; target: number },
  seats: readonly SeatScoring[]
): FoldRoundResult {
  const { finishingOrder, playerCount, gameMode, length } = round;
  const { target } = ledger;
  const seatOf = new Map(seats.map((s) => [s.engineId, s]));
  const keyOf = (engineId: string) => seatOf.get(engineId)?.key ?? null;
  const crownable = new Set(
    seats.flatMap((s) => (s.crownable && s.key !== null ? [s.key] : []))
  );

  const roundByKey: Record<string, number> = {};
  for (const [engineId, points] of Object.entries(scoreRound(finishingOrder, playerCount))) {
    const key = keyOf(engineId);
    if (key !== null) roundByKey[key] = points;
  }
  const cumulative = addPlacementPoints(ledger.cumulative, roundByKey);

  const teamOf: Record<string, string> = {};
  const teamOfKey: Record<string, string> = {};
  const frozen = new Set<string>();
  for (const s of seats) {
    if (s.team === undefined) continue;
    teamOf[s.engineId] = s.team;
    if (s.key !== null) teamOfKey[s.key] = s.team;
    if (s.frozenKey !== undefined) {
      teamOfKey[s.frozenKey] = s.team;
      frozen.add(s.frozenKey);
    }
  }
  const nameable = (key: string) => crownable.has(key) && !frozen.has(key);
  const teams = gameMode === "teams" && Object.keys(teamOfKey).length > 0;

  if (length === "single") {
    const championId = finishingOrder[0];
    if (gameMode === "teams" && championId !== undefined && teamOf[championId] !== undefined) {
      const teamPoints = aggregateTeamScores(scoreRound(finishingOrder, playerCount), teamOf);
      const best = Math.max(...Object.values(teamPoints));
      const topTeams = new Set(Object.keys(teamPoints).filter((team) => teamPoints[team] === best));
      const winners = Object.entries(teamOfKey)
        .filter(([key, team]) => topTeams.has(team) && nameable(key))
        .map(([key]) => key);
      return { roundByKey, cumulative, target, over: true, winners, isDraw: topTeams.size > 1 };
    }
    // The best-placed seat someone is still sitting in: `vacateSeat` keeps the departed player's
    // name, so announcing the top seat could credit the person who left.
    const championKey = finishingOrder.map(keyOf).find((key) => key !== null && crownable.has(key));
    return {
      roundByKey,
      cumulative,
      target,
      over: true,
      winners: championKey ? [championKey] : [],
      isDraw: false,
    };
  }

  const crownableCumulative: Record<string, number> = {};
  for (const [key, points] of Object.entries(cumulative)) {
    if (crownable.has(key)) crownableCumulative[key] = points;
  }
  const resolution = teams
    ? resolveTeamMatch(cumulative, teamOfKey, target, playerCount, nameable)
    : resolveMatch(crownableCumulative, target, playerCount);
  if (!resolution) {
    return { roundByKey, cumulative, target, over: false, winners: [], isDraw: false };
  }
  if (resolution.newTarget !== null) {
    return {
      roundByKey,
      cumulative,
      target: resolution.newTarget,
      over: false,
      winners: [],
      isDraw: false,
    };
  }
  return {
    roundByKey,
    cumulative,
    target,
    over: true,
    winners: resolution.winners,
    isDraw: resolution.isDraw,
  };
}

/**
 * Ends a round nobody is left to play: `winnerSeat` takes it, and every seat still holding cards is
 * placed behind them — closest to finishing first, seat order as a stable tiebreak. Every seat must
 * reach `finishingOrder`: the scoreboard awards from it and the stats writer reads it. Seats that
 * already emptied their hand keep the position they earned.
 */
export function concedeRound(state: GameState, winnerSeat?: number): GameState {
  const players = state.players.map((p) => ({ ...p }));
  const finishingOrder = [...state.finishingOrder];
  const place = (seat: number) => {
    const player = players[seat];
    if (!player || player.finishPosition !== undefined) return;
    player.finishPosition = finishingOrder.length + 1;
    finishingOrder.push(player.id);
  };

  if (winnerSeat !== undefined) place(winnerSeat);
  players
    .map((player, seat) => ({ player, seat }))
    .filter(({ player }) => player.finishPosition === undefined)
    .sort((a, b) => a.player.hand.length - b.player.hand.length || a.seat - b.seat)
    .forEach(({ seat }) => place(seat));

  return { ...state, players, finishingOrder, roundOver: true };
}

// ─── Match length ─────────────────────────────────────────────────────────────

/**
 * How long a match runs.
 *
 * - `match` — the canonical Murlan match (docs/GAME-RULES.md §12): first to
 *   `targetsFor(playerCount)[0]`, escalating on a tie at the target.
 * - `single` — one round and done.
 */
export type MatchLength = "match" | "single";

/** The target a match of this many seats opens on — the first rung of `targetsFor`. */
export function firstTargetFor(playerCount: number): number {
  const [target] = targetsFor(playerCount);
  if (target === undefined) throw new Error(`targetsFor(${playerCount}) returned no targets`);
  return target;
}
