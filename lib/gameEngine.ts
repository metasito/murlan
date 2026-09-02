import { getBotPersonality } from "./botPersonalities.ts";
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
export type PlayerType = "human" | "ai";
export type AIDifficulty = "easy" | "medium" | "hard";

export interface Player {
  id: string;
  name: string;
  hand: Card[];
  type: PlayerType;
  /** AI seats only. Absent means the default personality (lib/botPersonalities.ts). */
  personality?: BotPersonalityId;
  team?: "A" | "B";
  finishPosition?: number;
}

export interface ExchangePhase {
  active: boolean;
  winnerIdx: number;
  loserIdx: number;
  cardFromLoser: Card;
  /**
   * What the winner handed back. Absent until they choose, so it arrives in
   * the same state that closes the phase. Online this is the only record of
   * the return leg — every other seat's hand is sanitized out of the view.
   */
  cardToLoser?: Card;
  bothJokersException: boolean;
  /**
   * When the phase closed, in epoch ms — how long `cardToLoser` stays public.
   * Written by the server and never sent to a client; the engine must not write
   * it, or a clock inside the rules makes every engine test a different game.
   */
  settledAt?: number;
}

export interface StartReason {
  type: "start_card" | "lost_round" | "won_no_swap";
  card?: Card;
  playerIdx: number;
}

export interface GameState {
  players: Player[];
  currentTurnIndex: number;
  lastPlayedCombination: Combination | null;
  /**
   * Who made the play on the table. `processPass` clears the combination when a
   * round closes but leaves this naming that round's winner, so it answers "who
   * holds the round" only while `lastPlayedCombination` is set.
   */
  lastPlayedBy: number;
  passCount: number;
  gameMode: GameMode;
  roundWinner: number | null;
  gameOver: boolean;
  rankings: string[];
  firstPlayMade: boolean;
  startCard?: Card;
  startReason?: StartReason;
  exchangePhase?: ExchangePhase;
  /**
   * How many cards of each rank have been played this manche, indexed by
   * `getRankStrength`. Public information — every seat watched them land — so
   * `sanitizeStateForPlayer` passes it through untouched.
   *
   * Optional because `GameState` is persisted as jsonb: a hand in flight across
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
const DECK_BY_STRENGTH: number[] = RANK_ORDER.map((rank) =>
  rank === "joker_bw" || rank === "joker_colored" ? 1 : 4
);

export const emptyRankTally = (): number[] => new Array<number>(RANK_SLOTS).fill(0);

/**
 * How many cards stronger than `strength` are neither played nor in `myHand` —
 * that is, how many could still beat it in someone else's hand.
 *
 * At two seats twelve cards are never dealt (`dealCards` excludes them), so they
 * are counted here as outstanding. That errs towards caution — the bot may hold
 * back a card that was actually unbeatable — and never towards over-confidence,
 * which is the only direction that loses a hand it should have won.
 *
 * An absent `played` means nothing is known to have been played, which is what a
 * state rehydrated from before the tally existed must look like.
 */
export function outstandingAbove(
  strength: number,
  played: number[] | undefined,
  myHand: Card[]
): number {
  const out = outstandingTally(played, myHand);
  let total = 0;
  for (let i = strength + 1; i < RANK_SLOTS; i++) total += out[i];
  return total;
}

/** How many of each rank are neither played nor in `myHand`. */
function outstandingTally(played: number[] | undefined, myHand: Card[]): number[] {
  const mine = emptyRankTally();
  for (const card of myHand) mine[getRankStrength(card.rank)] += 1;
  return DECK_BY_STRENGTH.map((total, i) =>
    Math.max(0, total - (played?.[i] ?? 0) - mine[i])
  );
}

/**
 * Whether four of some rank are still unaccounted for, so an opponent could be
 * holding a bomb.
 *
 * `docs/RULES.md` §7.2: a bomb beats any single, pair, triple or straight of any
 * size, at any time — including a joker played as a single. So rank alone never
 * makes a card safe, and this is the half a tally can still answer exactly.
 */
export function bombPossible(played: number[] | undefined, myHand: Card[]): boolean {
  const out = outstandingTally(played, myHand);
  return out.some((n, i) => DECK_BY_STRENGTH[i] === 4 && n === 4);
}

export function cardStrength(card: Card): number {
  return getRankStrength(card.rank);
}

function getStraightFaceValue(rank: Rank, aceAsHigh: boolean): number | null {
  if (rank === "joker_bw" || rank === "joker_colored") return null;
  if (rank === "A") return aceAsHigh ? 14 : 1;
  const map: Partial<Record<Rank, number>> = {
    "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7,
    "8": 8, "9": 9, "10": 10, "J": 11, "Q": 12, "K": 13,
  };
  return map[rank] ?? null;
}

// A straight is 5..13 cards. The rules impose no maximum beyond the 13
// distinct sequence positions available (the Ace picks one end, never both).
export const STRAIGHT_MIN_LEN = 5;
export const STRAIGHT_MAX_LEN = 13;

// Jokers are never part of a sequence, so there is no joker substitution here:
// the face values must be exactly `totalLen` strictly consecutive integers.
function isConsecutiveSequence(faceValues: number[], totalLen: number): boolean {
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
  // Jokers cannot be used in straights — only as single cards
  if (cards.some((c) => c.isJoker)) return false;

  for (const aceAsHigh of [false, true]) {
    const faceValues = cards
      .map((c) => getStraightFaceValue(c.rank, aceAsHigh))
      .filter((v): v is number => v !== null);
    if (isConsecutiveSequence(faceValues, cards.length)) return true;
  }
  return false;
}

function getStraightStrength(cards: Card[]): number {
  // No jokers allowed in straights
  if (cards.some((c) => c.isJoker)) return 0;

  for (const aceAsHigh of [true, false]) {
    const faceValues = cards
      .map((c) => getStraightFaceValue(c.rank, aceAsHigh))
      .filter((v): v is number => v !== null);
    if (!isConsecutiveSequence(faceValues, cards.length)) continue;

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
  // Jokers not allowed in straights or royal straights
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
type RandomSource = { getRandomValues(array: Uint32Array): Uint32Array };

function getRandomSource(): RandomSource | null {
  const c = (globalThis as { crypto?: Partial<RandomSource> }).crypto;
  if (c && typeof c.getRandomValues === "function") return c as RandomSource;
  return null;
}

/**
 * Unbiased random integer in [0, maxExclusive).
 * Rejection sampling over a uint32: a plain `% maxExclusive` is biased whenever
 * maxExclusive does not divide 2^32 evenly.
 */
function randomBelow(maxExclusive: number): number {
  if (maxExclusive <= 1) return 0;
  const source = getRandomSource();
  if (!source) return Math.floor(Math.random() * maxExclusive);
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

export function shuffleDeck(deck: Card[]): Card[] {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = randomBelow(i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export const HEADS_UP_HAND = 14;

/**
 * Deals cards one at a time, round-robin from `firstSeat`. 4 players =
 * 14/14/13/13, 3 players = 18 each — the whole deck, so the 3♠ and both
 * Jokers are always in play. The two extra cards at 4 players land on
 * `firstSeat` and the seat after it, so rotating it between manches is what
 * stops the same seats holding the bigger hand for the whole match
 * (docs/RULES.md §3, the dealer's rotation).
 *
 * 2 players is the one seat count that does NOT deal the whole deck: dealing
 * everything leaves each player able to deduce the other's exact hand by
 * elimination, so 14 cards go to each (28 of 54) and the remaining 26 are
 * left face down and unused for the manche. It is the four-player hand size,
 * which is what makes a duel play like the game rather than like a
 * bomb-heavy variant of it (docs/RULES.md §3, decided in `docs/BRIEF.md` §3.1
 * after docs/research/card-dealing-variable-player-count.md).
 */
export function dealCards(
  playerCount: number,
  firstSeat = 0
): { hands: Card[][]; excluded: Card[] } {
  if (playerCount < 1) return { hands: [], excluded: [] };
  const deck = shuffleDeck(createDeck());
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
 * The holder of the 3♠ opens the first hand and must include it in the play.
 * At 3 and 4 players the whole deck is dealt, so the 3♠ is always in
 * somebody's hand. At 2 players it can land in the undealt pile (§ dealCards)
 * — the "lowest card held by anyone" fallback below is what actually opens
 * those hands, not just a defensive backstop.
 *
 * The synthesised-3♠ fallback below it exists only so a fully empty deal can
 * never crash.
 */
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
      if (!bestCard || cardStrength(card) < cardStrength(bestCard)) {
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

export function canPlay(
  candidate: Combination,
  lastPlayed: Combination | null
): boolean {
  if (!lastPlayed) return true;

  if (candidate.type === "royal_straight") {
    if (lastPlayed.type === "royal_straight") {
      return (
        candidate.cards.length === lastPlayed.cards.length &&
        candidate.strength > lastPlayed.strength
      );
    }
    return true;
  }

  if (candidate.type === "bomb") {
    if (lastPlayed.type === "royal_straight") return false;
    if (lastPlayed.type === "bomb") return candidate.strength > lastPlayed.strength;
    return true;
  }

  if (lastPlayed.type === "bomb" || lastPlayed.type === "royal_straight") return false;

  if (candidate.type !== lastPlayed.type) return false;
  if (candidate.cards.length !== lastPlayed.cards.length) return false;
  return candidate.strength > lastPlayed.strength;
}

// ─── Complete, correct valid-play enumeration ─────────────────────────────────
// Handles any hand size by enumerating by combination structure,
// not bitmask (bitmask fails for 2-player hands of 26 cards).

export function getAllValidPlays(
  hand: Card[],
  lastPlayed: Combination | null,
  isNewRound: boolean,
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
    if (!combo || !canPlay(combo, isNewRound ? null : lastPlayed)) return;
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

  // Singles
  for (const c of hand) tryAdd([c]);

  // Pairs (natural only — no jokers in pairs)
  for (const group of byRank.values()) {
    for (let i = 0; i < group.length; i++)
      for (let j = i + 1; j < group.length; j++)
        tryAdd([group[i], group[j]]);
  }

  // Triples (natural only — no jokers in triples)
  for (const group of byRank.values()) {
    for (let i = 0; i < group.length; i++)
      for (let j = i + 1; j < group.length; j++)
        for (let k = j + 1; k < group.length; k++)
          tryAdd([group[i], group[j], group[k]]);
  }

  // Bombs (4 natural same rank — no jokers)
  for (const group of byRank.values()) {
    if (group.length >= 4) tryAdd(group.slice(0, 4));
  }

  // ── Straights ───────────────────────────────────────────────────────────
  // Enumerate by sequence position, not by slicing a sorted array: a duplicate
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
 * Picks one card per sequence position. `requireCard` (the forced 3♠ opening)
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

// ─── AI ────────────────────────────────────────────────────────────────────────

function scorePlayForDump(play: Combination): number {
  const cardCount = play.cards.length;
  const hasHighCards = play.cards.some((c) => c.rank === "2" || c.isJoker);
  const avgStrength = play.strength / Math.max(cardCount, 1);
  return cardCount * 3 - avgStrength * 0.3 - (hasHighCards ? 5 : 0);
}

/** Spends a card worth hoarding: a 2, a joker, or a whole bomb. */
function isPremiumPlay(play: Combination): boolean {
  return (
    play.type === "bomb" ||
    play.type === "royal_straight" ||
    play.cards.some((c) => c.rank === "2" || c.isJoker)
  );
}

/**
 * The play to make when hoarding: shedding as many cards as possible on a
 * lead, answering as cheaply as possible otherwise. `null` when every legal
 * play is premium.
 */
function cheapestPlain(plays: Combination[], isNewRound: boolean): Combination | null {
  const plain = plays.filter((p) => !isPremiumPlay(p));
  if (plain.length === 0) return null;
  return [...plain].sort(
    isNewRound
      ? (a, b) => b.cards.length - a.cards.length || a.strength - b.strength
      : (a, b) => a.strength - b.strength
  )[0];
}

/**
 * Applies a personality's two knobs to the strategy tier's choice. Both only
 * re-rank plays the tier already had in hand, so nothing here can produce an
 * illegal play — `plays` is `getAllValidPlays`' output, untouched.
 */
function applyPersonality(
  choice: Combination | null,
  plays: Combination[],
  isNewRound: boolean,
  traits: { aggression: number; unpredictability: number; difficulty: AIDifficulty },
  rng: () => number
): Combination | null {
  let result = choice;

  if (result === null) {
    // The tier would pass. An aggressive personality contests the round instead.
    // Leading a round is never a pass, so this only ever runs when responding.
    if (!isNewRound && rng() < traits.aggression) {
      // Strength only compares within a shape, so answer in kind before
      // reaching for a bomb — the tier's emergency branch owns those.
      const inKind = plays.filter((p) => p.type !== "bomb" && p.type !== "royal_straight");
      const pool = inKind.length > 0 ? inKind : plays;
      const plain = pool.filter((p) => !isPremiumPlay(p));
      result = [...(plain.length > 0 ? plain : pool)].sort((a, b) => a.strength - b.strength)[0] ?? null;
    }
  } else if (isPremiumPlay(result) && rng() >= traits.aggression) {
    result = cheapestPlain(plays, isNewRound) ?? result;
  }

  if (result && rng() < traits.unpredictability) {
    const self = result;
    const alts = plays.filter(
      (p) => p !== self && p.type === self.type && p.cards.length === self.cards.length
    );
    if (alts.length > 0) {
      result = alts[Math.min(alts.length - 1, Math.floor(rng() * alts.length))];
    }
  }

  // Last, below the unpredictability knob: that knob swaps a play for a
  // same-shape alternative, premium ones included, so a floor placed any
  // earlier is overwritten by it.
  if (traits.difficulty === "hard" && result && isPremiumPlay(result)) {
    result = cheapestPlain(plays, isNewRound) ?? result;
  }

  return result;
}

/** The seat across the table, or `undefined` in any game without teams. */
function partnerSeat(state: GameState, seat: number): number | undefined {
  const count = state.players.length;
  const team = teamForSeat(seat, count, state.gameMode);
  if (team === undefined) return undefined;
  const partner = state.players.findIndex(
    (_, i) => i !== seat && teamForSeat(i, count, state.gameMode) === team
  );
  return partner === -1 ? undefined : partner;
}

/** What a bot at `seat` is allowed to read about the rest of the table. */
export function opponentsOf(
  state: GameState,
  seat: number
): { handCounts: number[]; partnerHoldsTop: boolean } {
  const partner = partnerSeat(state, seat);
  const handCounts = state.players
    .filter((_, i) => i !== seat && i !== partner)
    .map((p) => p.hand.length);
  return {
    // `Math.min()` of nothing is Infinity, which reads as "no one is close".
    handCounts: handCounts.length > 0 ? handCounts : [0],
    // Two things stop "my partner played last" from meaning "my partner holds
    // the round": `lastPlayedBy` still names the winner once everyone has
    // passed, and `processPass` gives the lead to the next seat *still holding
    // cards*, so a partner who has gone out would hand it to an opponent.
    partnerHoldsTop:
      partner !== undefined &&
      state.lastPlayedBy === partner &&
      state.lastPlayedCombination !== null &&
      (state.players[partner]?.hand.length ?? 0) > 0,
  };
}

/**
 * The AI's move for `player`, or null to pass. `rng` is a parameter so that
 * personalities can vary their play without making the engine untestable —
 * tests inject a fixed sequence and stay deterministic.
 */
export function aiChoosePlay(
  player: Player,
  lastPlayed: Combination | null,
  isNewRound: boolean,
  otherPlayersHandCount: number[],
  requireCard?: Card,
  rng: () => number = Math.random,
  partnerHoldsTop = false,
  playedRanks?: number[]
): Combination | null {
  const plays = getAllValidPlays(player.hand, lastPlayed, isNewRound, requireCard);
  if (plays.length === 0) return null;

  const personality = getBotPersonality(player.personality);
  const diff = personality.difficulty;
  const myCards = player.hand.length;
  const minOpponent = Math.min(...otherPlayersHandCount);

  /**
   * Whether leading this card takes the round on everything a tally can see:
   * no higher card is outstanding, and no rank is missing all four, so no
   * opponent can be holding a bomb (`docs/RULES.md` §7.2 — a bomb beats any
   * single, joker included).
   *
   * Singles only. A multi-card shape is also beaten by a higher shape of its
   * own size, which a rank tally cannot rule out.
   *
   * The one thing ranks cannot exclude is a royal straight, which needs five
   * consecutive cards of a single suit and so turns on suits this tally
   * deliberately does not hold. That is the residual risk, and it is a cheap
   * one: it is the strongest hand in the game (§7.4), so drawing one out to
   * answer a single card is a trade worth inducing.
   */
  const takesTheRound = (play: Combination) =>
    play.cards.length === 1 &&
    outstandingAbove(cardStrength(play.cards[0]), playedRanks, player.hand) === 0 &&
    !bombPossible(playedRanks, player.hand);

  // Universal: if this play empties the hand, always do it. No personality
  // declines to win, so this returns before the knobs are applied.
  const finishingPlays = plays.filter((p) => p.cards.length === myCards);
  if (finishingPlays.length > 0) {
    return finishingPlays[0];
  }

  // Beating the partner takes the round off the team that already had it, so
  // no tier answers and no knob contests. Below the finishing branch on
  // purpose: emptying the hand ends the manche in the team's favour, which is
  // not contesting anything. A new round cannot be passed at all.
  if (partnerHoldsTop && !isNewRound) return null;

  const withPersonality = (choice: Combination | null) =>
    applyPersonality(choice, plays, isNewRound, personality, rng);

  if (diff === "easy") {
    return withPersonality([...plays].sort((a, b) => a.strength - b.strength)[0]);
  }

  // A lead nothing left can answer takes the round for free, so holding it back
  // wins nothing and costs the lead. Cheapest such card first — the point is to
  // take the round, not to spend the best card doing it. Above the knobs
  // deliberately: aggression and unpredictability exist to colour a judgement
  // call, and this is as close to a counted one as the tally gets.
  if (isNewRound) {
    const certain = plays.filter(takesTheRound);
    if (certain.length > 0) {
      return certain.sort((a, b) => a.strength - b.strength)[0];
    }
  }

  const bombs = plays.filter(
    (p) => p.type === "bomb" || p.type === "royal_straight"
  );
  const normal = plays.filter(
    (p) => p.type !== "bomb" && p.type !== "royal_straight"
  );

  if (diff === "medium") {
    // Prefer lowest normal play; save bombs
    const pool = normal.length > 0 ? normal : bombs;
    // Slightly prefer multi-card plays when hand is large
    if (isNewRound && myCards > 8 && normal.length > 0) {
      const multi = normal.filter((p) => p.cards.length >= 2);
      if (multi.length > 0)
        return withPersonality(
          multi.sort((a, b) => b.cards.length - a.cards.length || a.strength - b.strength)[0]
        );
    }
    return withPersonality(pool.sort((a, b) => a.strength - b.strength)[0]);
  }

  // ── Hard AI ──────────────────────────────────────────────────────────────
  const conservative = normal.filter(
    (p) => !p.cards.some((c) => c.rank === "2" || c.isJoker)
  );
  const withHighCards = normal.filter((p) =>
    p.cards.some((c) => c.rank === "2" || c.isJoker)
  );

  // Emergency: opponent about to finish — use lowest bomb immediately. The one
  // decision no personality softens, or a cautious bot hoards a bomb into a loss.
  if (minOpponent <= 1 && !isNewRound && bombs.length > 0) {
    return bombs.sort((a, b) => a.strength - b.strength)[0];
  }

  if (isNewRound) {
    // We control the round: dump as many weak cards as efficiently as possible
    const near3 = plays.filter((p) => p.cards.length >= myCards - 2);
    if (near3.length > 0)
      return withPersonality(near3.sort((a, b) => b.cards.length - a.cards.length)[0]);

    // Prefer combos that score high on dump value (many cards, low strength)
    const candidates = conservative.length > 0 ? conservative : normal.length > 0 ? normal : bombs;
    if (candidates.length > 0)
      return withPersonality(candidates.sort((a, b) => scorePlayForDump(b) - scorePlayForDump(a))[0]);

    return withPersonality([...plays].sort((a, b) => scorePlayForDump(b) - scorePlayForDump(a))[0]);
  }

  // Responding to opponent's combo
  if (myCards <= 4 && normal.length > 0) {
    return withPersonality(normal.sort((a, b) => a.strength - b.strength)[0]);
  }

  // Prefer beating with lowest conservative card (preserve 2s/jokers)
  if (conservative.length > 0) {
    return withPersonality(conservative.sort((a, b) => a.strength - b.strength)[0]);
  }

  // Use high cards only if hand is small or opponent is close to winning
  if ((myCards <= 6 || minOpponent <= 3) && withHighCards.length > 0) {
    return withPersonality(withHighCards.sort((a, b) => a.strength - b.strength)[0]);
  }

  // Use bomb when opponent is close to winning and we have no normal play
  if (minOpponent <= 3 && bombs.length > 0) {
    return withPersonality(bombs.sort((a, b) => a.strength - b.strength)[0]);
  }

  // Pass — let the low-strength combo win this round, unless aggression contests it
  return withPersonality(null);
}

// ─── Game state processing ────────────────────────────────────────────────────

/**
 * Fills the remaining placements when a hand ends with players still holding
 * cards. Every seat must end up in `rankings`: the scoreboard awards from it
 * and the stats writer records from it, so a missing seat is a player who
 * silently played no game.
 *
 * No source specifies the order among unfinished seats, so fewest cards left
 * wins, seat order breaking ties. Mutates `state` — callers hold a clone.
 */
function assignRemainingPlacements(state: GameState): void {
  const remaining = state.players
    .map((p, seat) => ({ p, seat }))
    .filter(({ p }) => p.hand.length > 0 && p.finishPosition === undefined)
    .sort((a, b) => a.p.hand.length - b.p.hand.length || a.seat - b.seat);

  for (const { p } of remaining) {
    p.finishPosition = state.rankings.length + 1;
    state.rankings.push(p.id);
  }
}

/**
 * The engine's own floor under a play. Every caller gates as well — the server
 * by seat, the offline context before it commits, and an AI play is legal by
 * construction — but a caller that forgot would otherwise strip cards a hand
 * never held and leave the state quietly wrong rather than loudly refused.
 *
 * Turn ownership is not here on purpose: which seat is acting is resolved by
 * the transport, so the engine has nothing independent to check a claim of it
 * against. What it can check is that the seat on move holds what it is
 * playing, that the shape it claims is the shape its own cards actually form,
 * that the play beats the table, and — on the very first play of the match —
 * that it is the 3♠ (docs/RULES.md §4). Leading a fresh round otherwise
 * passes — there is nothing to beat, and `canPlay` says so.
 *
 * `combination.type`/`.strength` are re-derived from `.cards` rather than
 * trusted as given: a caller could otherwise claim any shape for any cards,
 * and `canPlay` compares only the claim. `buildCombination` is the one place
 * that derivation happens, so this calls it rather than repeating it.
 */
function assertPlayable(state: GameState, combination: Combination): void {
  const player = state.players[state.currentTurnIndex];
  if (!player) {
    throw new Error(`no player on seat ${state.currentTurnIndex}`);
  }
  if (combination.cards.length === 0) {
    throw new Error(`${player.name} played nothing`);
  }
  const held = new Set(player.hand.map((c) => c.id));
  const missing = combination.cards.filter((c) => !held.has(c.id)).map((c) => c.id);
  if (missing.length > 0) {
    throw new Error(`${player.name} does not hold ${missing.join(", ")}`);
  }
  const actual = buildCombination(combination.cards);
  if (!actual || actual.type !== combination.type || actual.strength !== combination.strength) {
    throw new Error(
      `${combination.cards.map((c) => c.id).join(", ")} is not a ${combination.type}`
    );
  }
  if (!canPlay(combination, state.lastPlayedCombination)) {
    throw new Error(
      `${combination.type} of ${combination.cards.length} does not beat the table`
    );
  }
  if (!state.firstPlayMade && state.startCard) {
    const hasStartCard = combination.cards.some((c) => c.id === state.startCard!.id);
    if (!hasStartCard) {
      throw new Error(`${player.name} must open with ${state.startCard.id}`);
    }
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
    const position = newState.rankings.length + 1;
    player.finishPosition = position;
    newState.rankings.push(player.id);

    const activePlayers = newState.players.filter((p) => p.hand.length > 0);

    if (newState.gameMode === "teams") {
      const winnerTeam = player.team;
      const teammateDone = newState.players.some(
        (p) =>
          p.team === winnerTeam &&
          p.finishPosition !== undefined &&
          p.id !== player.id
      );
      if (
        teammateDone ||
        newState.players.filter(
          (p) => p.hand.length > 0 && p.team !== winnerTeam
        ).length === 0
      ) {
        // The hand is decided, but the losing pair is still owed its placement
        // points (RULES.md §11/§12: both partners' finishing positions count).
        // Every seat must reach `rankings` — the stats writer skips anyone
        // absent from it.
        assignRemainingPlacements(newState);
        newState.gameOver = true;
        return newState;
      }
    }

    if (activePlayers.length <= 1) {
      assignRemainingPlacements(newState);
      newState.gameOver = true;
      return newState;
    }
  }

  newState.currentTurnIndex = getNextActivePlayer(newState);
  return newState;
}

export function processPass(state: GameState): GameState {
  // A player leading a new round must play something — passing is not a legal
  // move for them. The engine is the server-authoritative path, so it refuses
  // here rather than relying on the UI. State is returned untouched.
  if (state.lastPlayedCombination === null) return state;

  const newState = structuredClone(state);
  newState.passCount += 1;

  // The round closes once every OTHER player still holding cards has passed
  // consecutively. If the player who made the last play has already gone out
  // they are no longer among the active players, so every remaining active
  // player must be given a chance to answer — hence the +1 in that case.
  const activeCount = newState.players.filter((p) => p.hand.length > 0).length;
  const lastPlayer = newState.players[newState.lastPlayedBy];
  const lastPlayerStillActive = !!lastPlayer && lastPlayer.hand.length > 0;
  const passesNeeded = Math.max(
    1,
    lastPlayerStillActive ? activeCount - 1 : activeCount
  );

  if (newState.passCount >= passesNeeded) {
    newState.lastPlayedCombination = null;
    newState.passCount = 0;
    newState.roundWinner = newState.lastPlayedBy;

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
    newState.roundWinner = null;
    newState.currentTurnIndex = getNextActivePlayer(newState);
  }

  return newState;
}

function getNextActivePlayer(state: GameState): number {
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
  isNewRound: boolean
): boolean {
  return getAllValidPlays(hand, lastPlayed, isNewRound).length > 0;
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

export function initializeRematch(
  playerSetup: {
    name: string;
    type: PlayerType;
    personality?: BotPersonalityId;
    team?: "A" | "B";
    id?: string;
  }[],
  gameMode: GameMode,
  prevRankings: string[],
  firstSeat = 0
): GameState {
  const { hands } = dealCards(playerSetup.length, firstSeat);

  const players: Player[] = playerSetup.map((setup, i) => ({
    id: setup.id ?? `player_${i}`,
    name: setup.name,
    hand: sortHand(hands[i]),
    type: setup.type,
    personality: setup.personality,
    team: setup.team,
    finishPosition: undefined,
  }));

  const winnerId = prevRankings[0];
  const loserId = prevRankings[prevRankings.length - 1];
  const winnerIdx = players.findIndex((p) => p.id === winnerId);
  const loserIdx = players.findIndex((p) => p.id === loserId);

  const safeWinnerIdx = winnerIdx >= 0 ? winnerIdx : 0;
  const safeLoserIdx = loserIdx >= 0 ? loserIdx : players.length - 1;

  const loserHand = players[safeLoserIdx].hand;
  const bothJokersException = loserHasBothJokers(loserHand);

  if (bothJokersException) {
    return {
      players,
      currentTurnIndex: safeWinnerIdx,
      lastPlayedCombination: null,
      lastPlayedBy: safeWinnerIdx,
      playedRanks: emptyRankTally(),
      passCount: 0,
      gameMode,
      roundWinner: null,
      gameOver: false,
      rankings: [],
      firstPlayMade: true,
      startReason: { type: "won_no_swap", playerIdx: safeWinnerIdx },
      exchangePhase: {
        active: false,
        winnerIdx: safeWinnerIdx,
        loserIdx: safeLoserIdx,
        cardFromLoser: loserHand[0],
        bothJokersException: true,
      },
    };
  }

  // The hand was just dealt, so it is never empty — the only case the helper
  // has no card to return.
  const cardFromLoser = getBestCardFromHand(loserHand)!;

  players[safeLoserIdx].hand = players[safeLoserIdx].hand.filter((c) => c.id !== cardFromLoser.id);
  players[safeWinnerIdx].hand = sortHand([...players[safeWinnerIdx].hand, cardFromLoser]);

  return {
    players,
    currentTurnIndex: safeWinnerIdx,
    lastPlayedCombination: null,
    lastPlayedBy: safeWinnerIdx,
    playedRanks: emptyRankTally(),
    passCount: 0,
    gameMode,
    roundWinner: null,
    gameOver: false,
    rankings: [],
    firstPlayMade: true,
    startReason: { type: "lost_round", playerIdx: safeLoserIdx },
    exchangePhase: {
      active: true,
      winnerIdx: safeWinnerIdx,
      loserIdx: safeLoserIdx,
      cardFromLoser,
      bothJokersException: false,
    },
  };
}

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
 * that straight back is not an exchange (docs/RULES.md §10). A hand can hold
 * no card in 3-10 at all, and an empty result deadlocks the exchange behind an
 * undismissable overlay, so there the single lowest card is the giveback.
 */
/** The card an AI gives back: the weakest legal choice, or the lowest card in
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
  return state.exchangePhase.bothJokersException
    ? state.exchangePhase.winnerIdx
    : state.exchangePhase.loserIdx;
}

/** Teams is 2-v-2 and only 2-v-2 (docs/RULES.md §11). */
export const TEAMS_PLAYER_COUNT = 4;

/**
 * The team a seat plays for. Partners sit opposite each other, so the teams
 * alternate around the table. Undefined for every game that is not a teams
 * game of exactly `TEAMS_PLAYER_COUNT` seats — an odd table has no 2-v-2 to
 * split into, and `resolveTeamMatch` would race a pair against a single seat.
 */
export function teamForSeat(
  seat: number,
  playerCount: number,
  gameMode: GameMode
): "A" | "B" | undefined {
  if (gameMode !== "teams" || playerCount !== TEAMS_PLAYER_COUNT) return undefined;
  return seat % 2 === 0 ? "A" : "B";
}

/** The seat the next manche deals from — one further round the table. */
export function nextDealFirstSeat(firstSeat: number, playerCount: number): number {
  if (playerCount < 1) return 0;
  return (firstSeat + 1) % playerCount;
}

export function initializeGame(
  playerSetup: {
    name: string;
    type: PlayerType;
    personality?: BotPersonalityId;
    team?: "A" | "B";
  }[],
  gameMode: GameMode,
  firstSeat = 0,
  /**
   * The deal, when the caller already has one. `shuffleDeck` draws from
   * `crypto`, so a hand that has already been played can only be rebuilt by
   * handing the cards back in — which is what replaying a soak log is
   * (`tests/integration/soakLogReplays.test.ts`). Everything downstream of the
   * deal, the opening seat included, is derived here either way.
   */
  dealt?: Card[][]
): GameState {
  const hands = dealt ?? dealCards(playerSetup.length, firstSeat).hands;
  if (dealt) {
    // This is the one way cards enter a game from outside the deck, so it is
    // the one place "a card appears exactly once" can be broken by a caller.
    if (dealt.length !== playerSetup.length) {
      throw new Error(`a deal for ${playerSetup.length} seats has ${dealt.length} hands`);
    }
    const seen = new Set<string>();
    for (const hand of dealt) {
      for (const card of hand) {
        if (seen.has(card.id)) throw new Error(`card ${card.id} is dealt twice`);
        seen.add(card.id);
      }
    }
  }

  const players: Player[] = playerSetup.map((setup, i) => ({
    id: `player_${i}`,
    name: setup.name,
    hand: sortHand(hands[i]),
    type: setup.type,
    personality: setup.personality,
    team: setup.team,
    finishPosition: undefined,
  }));

  const { playerIdx: startIdx, startCard } = findStartingPlayer(players);

  return {
    players,
    currentTurnIndex: startIdx,
    lastPlayedCombination: null,
    lastPlayedBy: startIdx,
    playedRanks: emptyRankTally(),
    passCount: 0,
    gameMode,
    roundWinner: null,
    gameOver: false,
    rankings: [],
    firstPlayMade: false,
    startCard,
    startReason: { type: "start_card", card: startCard, playerIdx: startIdx },
  };
}

// ─── Match scoring ────────────────────────────────────────────────────────────
// Pure, side-effect-free primitives. The server owns the cumulative totals and
// the persistence; this module only says what a hand is worth and whether the
// match is over.

/**
 * Match point targets, in escalation order. The match is won by the first
 * player to reach the current target; if two or more reach it in the same hand
 * the target escalates to the next entry. 51 is the last one — a tie there is
 * a draw.
 */
export const MATCH_TARGETS: readonly number[] = [21, 31, 41, 51];

/**
 * The escalation ladder for a table of `playerCount` seats.
 *
 * `scoreHand` pays N−1 down to 0, so a manche is worth 6 points at four seats,
 * 3 at three and 1 at two — a flat ladder therefore made a 1-v-1 partita a
 * 27-manche affair nobody finished. Scaling by (N−1)/3 keeps every count in
 * the 8-12 manche band a match should land in, and leaves the four-player
 * values docs/RULES.md §12 documents untouched.
 */
export function targetsFor(playerCount: number): number[] {
  return MATCH_TARGETS.map((t) => Math.round((t * (playerCount - 1)) / 3));
}

export interface MatchResolution {
  /** Match winner(s). Empty when the target merely escalated. */
  winners: string[];
  /** The new target to keep playing to, or null when the match has ended. */
  newTarget: number | null;
  /** True when the match ended tied at the final target. */
  isDraw: boolean;
}

/**
 * Points awarded for one hand. 4 players: 1st = 3, 2nd = 2, 3rd = 1, last = 0.
 * Generalised to N players as N-1 down to 0.
 *
 * `rankings` is the finishing order (GameState.rankings), best first. Players
 * absent from it score 0 and are not present in the result.
 */
export function scoreHand(
  rankings: string[],
  playerCount: number
): Record<string, number> {
  const scores: Record<string, number> = {};
  for (let i = 0; i < rankings.length; i++) {
    scores[rankings[i]] = Math.max(playerCount - 1 - i, 0);
  }
  return scores;
}

/** Adds a hand's points onto the running totals. Returns a new object. */
export function addHandScores(
  cumulative: Record<string, number>,
  handScores: Record<string, number>
): Record<string, number> {
  const merged: Record<string, number> = { ...cumulative };
  for (const [id, points] of Object.entries(handScores)) {
    merged[id] = (merged[id] ?? 0) + points;
  }
  return merged;
}

/** The target that follows `target`, or null when `target` is the last one. */
export function nextMatchTarget(target: number, playerCount = 4): number | null {
  return targetsFor(playerCount).find((t) => t > target) ?? null;
}

/**
 * Decides the state of the match after a hand has been scored.
 *
 * - Nobody at the target yet          → null (keep playing to the same target)
 * - Exactly one player at the target  → { winners: [id], newTarget: null }
 * - Two or more at the target         → escalate: { winners: [], newTarget }
 * - One player alone at the final target → an ordinary win
 * - Two or more sharing the top score  → { winners: [tied ids], isDraw: true }
 */
export function resolveMatch(
  cumulative: Record<string, number>,
  target: number,
  playerCount = 4
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

/**
 * Sums each partner's cumulative points onto their team.
 *
 * `teamOfKey` maps a scoring key (a userId) to its team id. Keys absent from
 * it are ignored entirely — that is how vacated/bot seats stay out of a team
 * total, mirroring `FoldHandInput.accumulates` on the per-hand path.
 */
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
 * Teams-mode match resolution. RULES.md §11: the partners' placement points are
 * **summed** and the pair races to the target — never decided per seat.
 * Escalation and the draw rule apply to team totals, and winners expand back to
 * every member key so both partners are reported.
 */
export function resolveTeamMatch(
  cumulative: Record<string, number>,
  teamOfKey: Record<string, string>,
  target: number,
  playerCount = 4
): MatchResolution | null {
  const totals = aggregateTeamScores(cumulative, teamOfKey);
  // The ladder is the seated table's, not the two teams' — a pair races to the
  // four-seat target on the six points a four-seat manche pays out.
  const resolution = resolveMatch(totals, target, playerCount);
  if (!resolution) return null;

  const winningTeams = new Set(resolution.winners);
  return {
    ...resolution,
    winners: Object.entries(teamOfKey)
      .filter(([, team]) => winningTeams.has(team))
      .map(([key]) => key),
  };
}

/**
 * Both the live path and the restore path go through here, so they cannot
 * answer "is this match decided?" differently.
 */
export function resolveMatchFor(args: {
  gameMode: GameMode;
  cumulative: Record<string, number>;
  teamOfKey: Record<string, string>;
  target: number;
  playerCount: number;
}): MatchResolution | null {
  const { gameMode, cumulative, teamOfKey, target, playerCount } = args;
  return gameMode === "teams" && Object.keys(teamOfKey).length > 0
    ? resolveTeamMatch(cumulative, teamOfKey, target, playerCount)
    : resolveMatch(cumulative, target, playerCount);
}

export interface FoldHandInput {
  /** The manche's finishing order, best first, in engine player ids. */
  rankings: string[];
  playerCount: number;
  length: MatchLength;
  gameMode: GameMode;
  target: number;
  cumulative: Record<string, number>;
  /**
   * The key an engine player id scores under. Offline that is the id itself;
   * on the server it is the seated userId, or the `bot:<seat>` sentinel for a
   * seat its human left. null drops the id — it belongs to no seat at all.
   */
  keyOf: (engineId: string) => string | null;
  /**
   * Whether a key's points join the running match total. Defaults to all of
   * them. The server declines its `bot:<seat>` sentinels: a vacated seat has
   * to appear on the hand's scoreboard, but must never accumulate towards
   * winning the match under the departed human's name.
   */
  accumulates?: (key: string) => boolean;
  /** Engine player id -> team id, for every seat that has one. */
  teamOf?: Record<string, string>;
}

export interface FoldHandResult {
  /** What the manche paid, by scoring key. Non-accumulating keys included. */
  handByKey: Record<string, number>;
  cumulative: Record<string, number>;
  /** What to play to next — escalated if this manche tied at the old target. */
  target: number;
  over: boolean;
  winners: string[];
  isDraw: boolean;
}

/**
 * Folds a finished manche into its match: awards the placement points, then
 * either escalates the target, ends the match, or leaves it running.
 *
 * A single-manche game ends here by definition, with no target involved — its
 * winner is whoever took the manche, or in teams the pair (docs/RULES.md §11).
 *
 * Keyed by an opaque string so offline and the server share one progression:
 * offline scores by engine player id, the server by userId.
 */
export function foldHandIntoMatch(input: FoldHandInput): FoldHandResult {
  const { rankings, playerCount, length, gameMode, target, keyOf } = input;
  const accumulates = input.accumulates ?? (() => true);
  const teamOf = input.teamOf ?? {};

  const handByKey: Record<string, number> = {};
  for (const [engineId, points] of Object.entries(scoreHand(rankings, playerCount))) {
    const key = keyOf(engineId);
    if (key === null) continue;
    handByKey[key] = points;
  }

  const scorable: Record<string, number> = {};
  for (const [key, points] of Object.entries(handByKey)) {
    if (accumulates(key)) scorable[key] = points;
  }
  const cumulative = addHandScores(input.cumulative, scorable);

  const teamOfKey: Record<string, string> = {};
  for (const [engineId, team] of Object.entries(teamOf)) {
    const key = keyOf(engineId);
    if (key === null || !accumulates(key)) continue;
    teamOfKey[key] = team;
  }

  if (length === "single") {
    const championId = rankings[0];
    const championTeam = championId === undefined ? undefined : teamOf[championId];
    if (gameMode === "teams" && championTeam !== undefined) {
      // A manche is taken by a pair (docs/RULES.md §11), and `teamOfKey`
      // already holds only the keys that accumulate, so a vacated seat's
      // partner is named and the seat itself never is.
      const winners = Object.entries(teamOfKey)
        .filter(([, team]) => team === championTeam)
        .map(([key]) => key);
      return { handByKey, cumulative, target, over: true, winners, isDraw: false };
    }
    // The best-placed seat someone is still sitting in. The top one may have
    // been walked out of, and `vacateSeat` keeps the departed player's name —
    // announcing it credits the match to the person who left.
    const championKey = rankings
      .map(keyOf)
      .find((key) => key !== null && accumulates(key));
    return {
      handByKey,
      cumulative,
      target,
      over: true,
      winners: championKey ? [championKey] : [],
      isDraw: false,
    };
  }

  const resolution = resolveMatchFor({ gameMode, cumulative, teamOfKey, target, playerCount });
  if (!resolution) {
    return { handByKey, cumulative, target, over: false, winners: [], isDraw: false };
  }
  if (resolution.newTarget !== null) {
    return {
      handByKey,
      cumulative,
      target: resolution.newTarget,
      over: false,
      winners: [],
      isDraw: false,
    };
  }
  return {
    handByKey,
    cumulative,
    target,
    over: true,
    winners: resolution.winners,
    isDraw: resolution.isDraw,
  };
}

// ─── Match length and the rematch question ────────────────────────────────────

/**
 * How long a game runs.
 *
 * - `match` — the canonical Murlan match (docs/RULES.md §12): first to
 *   `targetsFor(playerCount)[0]`, escalating on a tie at the target.
 * - `single` — one manche and done.
 */
export type MatchLength = "match" | "single";

/** The target a match of this many seats opens on — the first rung of `targetsFor`. */
export function firstTargetFor(playerCount: number): number {
  const [target] = targetsFor(playerCount);
  if (target === undefined) throw new Error(`targetsFor(${playerCount}) returned no targets`);
  return target;
}

/** Cards left in the shortest hand at or below which a manche counts as closing. */
export const CLOSING_HAND_CARDS = 5;

/**
 * Whether the game is close enough to over to be worth asking the table
 * whether they want another one — true once the current manche is nearly
 * played out *and* it can be the last one, either because the game is a
 * single manche or because the leader can reach the target from it.
 */
export function matchIsClosing(args: {
  length: MatchLength;
  target: number;
  cumulative: Record<string, number>;
  handCounts: number[];
  playerCount: number;
}): boolean {
  const { length, target, cumulative, handCounts, playerCount } = args;
  if (handCounts.length === 0) return false;
  if (Math.min(...handCounts) > CLOSING_HAND_CARDS) return false;
  if (length === "single") return true;
  const leader = Math.max(0, ...Object.values(cumulative));
  return leader + (playerCount - 1) >= target;
}

/** Strictly more than half. A table split down the middle stops. */
export function isMajority(yesCount: number, seatCount: number): boolean {
  return yesCount * 2 > seatCount;
}

/**
 * The rematch verdict's two inputs: how many seats said yes, and how many
 * seats had anyone to say it. `"abstain"` is a seat with nobody behind it —
 * on the server a bot seat, or a seat its human walked out of — and counts
 * toward neither.
 */
export function tallyRematchAnswers(
  seatCount: number,
  answerOf: (seat: number) => boolean | "abstain"
): { yes: number; total: number } {
  let yes = 0;
  let total = 0;
  for (let seat = 0; seat < seatCount; seat++) {
    const answer = answerOf(seat);
    if (answer === "abstain") continue;
    total++;
    if (answer) yes++;
  }
  return { yes, total };
}
