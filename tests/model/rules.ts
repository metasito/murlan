/** Where docs/GAME-RULES.md states no rule; each id is an entry in tests/model/disagreements.json. */
export type SilenceId =
  | "thirteen-card-straight-top"
  | "last-place-highest-card-tied"
  | "giveback-received-is-the-only-3-to-10"
  | "giveback-lowest-card-tied"
  | "giveback-lowest-card-is-the-received";
export interface Silent {
  silent: SilenceId;
}
const silent = (id: SilenceId): Silent => ({ silent: id });
export const isSilent = (value: unknown): value is Silent => typeof value === "object" && value !== null && "silent" in value;

export type Suit = "clubs" | "diamonds" | "hearts" | "spades";
export type Rank = "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K" | "A" | "2" | "joker_bw" | "joker_colored";
export interface ModelCard {
  id: string;
  suit: Suit | null;
  rank: Rank;
}

/** docs/GAME-RULES.md §2: the 2-player opening tie's order, ♣ < ♦ < ♥ < ♠. */
const SUIT_ORDER: Suit[] = ["clubs", "diamonds", "hearts", "spades"];
const STRENGTH_ORDER: Rank[] = ["3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A", "2", "joker_bw", "joker_colored"];
const ORDINARY: Rank[] = STRENGTH_ORDER.slice(0, 13);
const isJoker = (card: ModelCard) => card.suit === null;

/** docs/GAME-RULES.md §1. */
export function deck(): ModelCard[] {
  const ordinary = SUIT_ORDER.flatMap((suit) => ORDINARY.map((rank) => ({ id: `${rank}_${suit}`, suit, rank })));
  return [...ordinary, { id: "joker_bw", suit: null, rank: "joker_bw" }, { id: "joker_colored", suit: null, rank: "joker_colored" }];
}

/** docs/GAME-RULES.md §2. */
export const strength = (card: ModelCard): number => STRENGTH_ORDER.indexOf(card.rank);

export type Kind = "single" | "pair" | "triple" | "bomb" | "straight" | "royal";
export interface Combo {
  kind: Kind;
  size: number;
  strength: number | Silent;
}

/** docs/GAME-RULES.md §6: the 2 is low only, the Ace either end. */
function sequencePositions(rank: Rank): number[] {
  if (rank === "A") return [1, 14];
  if (rank === "2") return [2];
  return [ORDINARY.indexOf(rank) + 3];
}

/** docs/GAME-RULES.md §6 and § Decisions "Straight length": every reading's top card. */
function straightTops(cards: ModelCard[]): number[] {
  if (cards.length < 5 || cards.length > 13 || cards.some(isJoker)) return [];
  if (new Set(cards.map((c) => c.rank)).size !== cards.length) return [];
  const tops = new Set<number>();
  const readings = cards.reduce<number[][]>(
    (acc, card) => acc.flatMap((reading) => sequencePositions(card.rank).map((p) => [...reading, p])),
    [[]]
  );
  for (const reading of readings) {
    const sorted = [...reading].sort((a, b) => a - b);
    if (sorted.every((p, i) => i === 0 || p === sorted[i - 1] + 1)) tops.add(sorted[sorted.length - 1]);
  }
  return [...tops];
}

/** docs/GAME-RULES.md §5–§6: null when the cards are no combination. */
export function classify(cards: ModelCard[]): Combo | null {
  const size = cards.length;
  if (size === 0) return null;
  if (size === 1) return { kind: "single", size, strength: strength(cards[0]) };
  if (size <= 4) {
    if (cards.some(isJoker) || cards.some((c) => c.rank !== cards[0].rank)) return null;
    const kind: Kind = size === 2 ? "pair" : size === 3 ? "triple" : "bomb";
    return { kind, size, strength: strength(cards[0]) };
  }
  const tops = straightTops(cards);
  if (tops.length === 0) return null;
  const royal = cards.every((c) => c.suit === cards[0].suit);
  return { kind: royal ? "royal" : "straight", size, strength: tops.length === 1 ? tops[0] : silent("thirteen-card-straight-top") };
}

function higher(candidate: Combo, toBeat: Combo): boolean | Silent {
  if (isSilent(candidate.strength)) return candidate.strength;
  if (isSilent(toBeat.strength)) return toBeat.strength;
  return candidate.strength > toBeat.strength;
}

/** docs/GAME-RULES.md §7 and § Decisions "Royal straight beats any play"; `toBeat` null is a lead. */
export function beats(candidate: Combo, toBeat: Combo | null): boolean | Silent {
  if (toBeat === null) return true;
  if (candidate.kind === "royal") return toBeat.kind !== "royal" || (toBeat.size === candidate.size && higher(candidate, toBeat));
  if (toBeat.kind === "royal") return false;
  if (candidate.kind === "bomb") return toBeat.kind !== "bomb" || higher(candidate, toBeat);
  if (toBeat.kind === "bomb") return false;
  return candidate.kind === toBeat.kind && candidate.size === toBeat.size && higher(candidate, toBeat);
}

function subsetsOf<T>(items: T[]): T[][] {
  return items.reduce<T[][]>((acc, item) => acc.concat(acc.map((s) => [...s, item])), [[]]);
}

const sameRankRuns = (hand: ModelCard[]) => [...new Set(hand.map((c) => c.rank))].flatMap((rank) => subsetsOf(hand.filter((c) => c.rank === rank)).filter((s) => s.length > 0 && s.length <= 4));

const SEQUENCE_LINE: Rank[] = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];

function distinctRankRuns(hand: ModelCard[]): ModelCard[][] {
  const byRank = new Map<Rank, ModelCard[]>();
  for (const card of hand.filter((c) => !isJoker(c))) byRank.set(card.rank, [...(byRank.get(card.rank) ?? []), card]);
  const windows: Rank[][] = [];
  for (let start = 0; start < SEQUENCE_LINE.length; start++) {
    for (let end = start + 5; end <= Math.min(start + 13, SEQUENCE_LINE.length); end++) windows.push(SEQUENCE_LINE.slice(start, end));
  }
  return windows
    .filter((ranks) => ranks.every((rank) => byRank.has(rank)))
    .flatMap((ranks) => ranks.reduce<ModelCard[][]>((acc, rank) => acc.flatMap((s) => byRank.get(rank)!.map((c) => [...s, c])), [[]]));
}

/** docs/GAME-RULES.md §4, §5, §7; `silent` holds the sets the doc leaves open against `toBeat`. */
export function legalPlays(hand: ModelCard[], toBeat: Combo | null, mustInclude: string | null): { plays: string[][]; silent: string[][] } {
  const plays = new Map<string, string[]>();
  const silenced = new Map<string, string[]>();
  for (const cards of [...sameRankRuns(hand), ...distinctRankRuns(hand)]) {
    if (mustInclude !== null && !cards.some((c) => c.id === mustInclude)) continue;
    const ids = cards.map((c) => c.id).sort();
    const combo = classify(cards);
    const verdict = combo === null ? false : beats(combo, toBeat);
    if (isSilent(verdict)) silenced.set(ids.join(), ids);
    else if (verdict) plays.set(ids.join(), ids);
  }
  return { plays: [...plays.values()], silent: [...silenced.values()] };
}

/** docs/GAME-RULES.md §4 and § Decisions "2-player opening tie": the first round at a table. */
export function opening(hands: ModelCard[][]): { seat: number; cardId: string } {
  const spade3 = hands.findIndex((hand) => hand.some((c) => c.id === "3_spades"));
  if (spade3 >= 0) return { seat: spade3, cardId: "3_spades" };
  if (hands.length !== 2) throw new Error(`§4 deals the 3♠ at ${hands.length} seats, and none of these hands holds it`);
  const dealt = hands.flatMap((hand, seat) => hand.map((card) => ({ card, seat })));
  dealt.sort((a, b) => strength(a.card) - strength(b.card) || SUIT_ORDER.indexOf(a.card.suit!) - SUIT_ORDER.indexOf(b.card.suit!));
  return { seat: dealt[0].seat, cardId: dealt[0].card.id };
}

/** docs/GAME-RULES.md §8 and § Decisions "The direction the deal runs": seat `current - 1`, skipping empty hands. */
export function nextActive(from: number, hands: ModelCard[][]): number {
  for (let step = 1; step <= hands.length; step++) {
    const seat = (from - step + hands.length * step) % hands.length;
    if (hands[seat].length > 0) return seat;
  }
  return from;
}

export interface Round {
  hands: ModelCard[][];
  toAct: number;
  table: { combo: Combo; by: number } | null;
  passes: number;
  mustInclude: string | null;
  finishingOrder: number[];
  roundOver: boolean;
}

export type Move = { kind: "play"; cardIds: string[] } | { kind: "pass" };
export type Step = { ok: true; round: Round; closedTrick: boolean } | { ok: false };

/** docs/GAME-RULES.md §4: the first round at a table, opened by `opening`. */
export function firstRound(hands: ModelCard[][]): Round {
  const open = opening(hands);
  return { hands, toAct: open.seat, table: null, passes: 0, mustInclude: open.cardId, finishingOrder: [], roundOver: false };
}

/** docs/GAME-RULES.md §9: a play by the seat to act. */
function play(round: Round, cardIds: string[]): Step | Silent {
  const seat = round.toAct;
  const hand = round.hands[seat];
  const cards = cardIds.map((id) => hand.find((c) => c.id === id));
  if (new Set(cardIds).size !== cardIds.length || cards.some((c) => c === undefined)) return { ok: false };
  if (round.mustInclude !== null && !cardIds.includes(round.mustInclude)) return { ok: false };
  const combo = classify(cards as ModelCard[]);
  const verdict = combo === null ? false : beats(combo, round.table?.combo ?? null);
  if (isSilent(verdict)) return verdict;
  if (combo === null || !verdict) return { ok: false };
  const hands = round.hands.map((h, i) => (i === seat ? h.filter((c) => !cardIds.includes(c.id)) : h));
  const finishingOrder = hands[seat].length === 0 ? [...round.finishingOrder, seat] : round.finishingOrder;
  const holding = hands.flatMap((h, i) => (h.length > 0 ? [i] : []));
  const base = { hands, passes: 0, mustInclude: null, table: { combo, by: seat } };
  if (holding.length <= 1) {
    return { ok: true, closedTrick: false, round: { ...base, toAct: seat, finishingOrder: [...finishingOrder, ...holding], roundOver: true } };
  }
  return { ok: true, closedTrick: false, round: { ...base, toAct: nextActive(seat, hands), finishingOrder, roundOver: false } };
}

/** docs/GAME-RULES.md §9, "all other active players pass consecutively". */
function pass(round: Round): Step {
  if (round.table === null) return { ok: false };
  const { by } = round.table;
  const passes = round.passes + 1;
  const others = round.hands.filter((h, i) => i !== by && h.length > 0).length;
  if (passes < others) return { ok: true, closedTrick: false, round: { ...round, passes, toAct: nextActive(round.toAct, round.hands) } };
  const lead = round.hands[by].length > 0 ? by : nextActive(by, round.hands);
  return { ok: true, closedTrick: true, round: { ...round, passes: 0, table: null, toAct: lead } };
}

/** docs/GAME-RULES.md §9: a move by the seat to act. */
export function step(round: Round, move: Move): Step | Silent {
  if (round.roundOver) return { ok: false };
  return move.kind === "pass" ? pass(round) : play(round, move.cardIds);
}

const GIVEBACK_RANKS: Rank[] = ["3", "4", "5", "6", "7", "8", "9", "10"];

/** docs/GAME-RULES.md §10 and § Decisions "What the winner may hand back"; `hand` already holds `receivedId`. */
export function givebackOptions(hand: ModelCard[], receivedId: string): string[] | Silent {
  const inRange = hand.filter((c) => GIVEBACK_RANKS.includes(c.rank));
  const offered = inRange.filter((c) => c.id !== receivedId);
  if (offered.length > 0) return offered.map((c) => c.id).sort();
  if (inRange.length > 0) return silent("giveback-received-is-the-only-3-to-10");
  const lowest = Math.min(...hand.map(strength));
  const lowestCards = hand.filter((c) => strength(c) === lowest);
  if (lowestCards.length !== 1) return silent("giveback-lowest-card-tied");
  if (lowestCards[0].id === receivedId) return silent("giveback-lowest-card-is-the-received");
  return [lowestCards[0].id];
}

export type Exchange = { kind: "shown"; leader: "first" } | { kind: "swap"; fromLast: string; leader: "last" };

/** docs/GAME-RULES.md §10 and its two-Joker exception: what the last-place hand owes, and who leads. */
export function exchange(lastHand: ModelCard[]): Exchange | Silent {
  if (lastHand.some((c) => c.id === "joker_bw") && lastHand.some((c) => c.id === "joker_colored")) return { kind: "shown", leader: "first" };
  const top = Math.max(...lastHand.map(strength));
  const highest = lastHand.filter((c) => strength(c) === top);
  if (highest.length !== 1) return silent("last-place-highest-card-tied");
  return { kind: "swap", fromLast: highest[0].id, leader: "last" };
}
