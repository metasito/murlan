// Loaded by `node --test`, jest and Playwright alike: no `@/` alias, and the `.ts` specifier
// Node's loader needs (docs/agents/checks.md).
import { emptyRankTally, getRankStrength } from "../../lib/game/gameEngine.ts";
import type { Card, GameState, Player, Rank, Suit } from "../../lib/game/gameEngine.ts";
import type { BotView } from "../../lib/game/bot.ts";

/** Id is rank_suit, matching createDeck(). */
export const card = (rank: Rank, suit: Suit): Card => ({
  id: `${rank}_${suit}`,
  suit,
  rank,
  isJoker: false,
});

export const joker = (kind: "bw" | "colored"): Card => ({
  id: kind === "bw" ? "joker_bw" : "joker_colored",
  suit: null,
  rank: kind === "bw" ? "joker_bw" : "joker_colored",
  isJoker: true,
});

/** Order-insensitive. */
export const cardKey = (cards: Card[]): string =>
  cards
    .map((c) => c.id)
    .sort()
    .join(",");

export function seat(i: number, hand: Card[] = [], over: Partial<Player> = {}): Player {
  return { id: `p${i}`, name: `p${i}`, hand, type: "human", ...over };
}

/** A round someone has played into, one 3 down: `roundUnplayed` reads false on it. */
export function aThreePlayed(): number[] {
  const tally = emptyRankTally();
  tally[getRankStrength("3")] = 1;
  return tally;
}

export function state(over: Partial<GameState> = {}): GameState {
  return {
    players: [seat(0), seat(1), seat(2), seat(3)],
    currentTurnIndex: 0,
    lastPlayedCombination: null,
    lastPlayedBy: 0,
    passCount: 0,
    gameMode: "free_for_all",
    trickWinner: null,
    roundOver: false,
    finishingOrder: [],
    firstPlayMade: false,
    playedRanks: emptyRankTally(),
    lastMove: { seq: 0, kind: "deal" },
    ...over,
  };
}

/** `player` leading a new trick, reading nothing of the table beyond what `over` sets. */
export function viewOf(player: Player, over: Partial<BotView> = {}): BotView {
  return {
    hand: player.hand,
    personality: player.personality,
    toBeat: null,
    opponentHandCounts: [13],
    partnerHoldsTop: false,
    playedRanks: emptyRankTally(),
    ...over,
  };
}

/**
 * Self-contained so Playwright can ship its source into the page (`String(mulberry32)`): it may
 * reference nothing outside its own body.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `lib/game/gameEngine.ts`'s `RandomSource`, which the deal draws from. */
interface RandomSource {
  getRandomValues(array: Uint32Array): Uint32Array;
}

interface Rng {
  next: () => number;
  source: RandomSource;
}

/** One stream behind both: `next` for a bot's choice, `source` for the deal. */
export function rng(seed: number): Rng {
  const next = mulberry32(seed);
  return {
    next,
    source: {
      getRandomValues(array) {
        for (let i = 0; i < array.length; i++) array[i] = Math.floor(next() * 0x100000000);
        return array;
      },
    },
  };
}

/** `count` distinct cards from `deck`. */
export function sample(deck: Card[], count: number, rand: () => number): Card[] {
  const pool = [...deck];
  for (let i = pool.length - 1; i > 0; i--) {
    const k = Math.floor(rand() * (i + 1));
    [pool[i], pool[k]] = [pool[k], pool[i]];
  }
  return pool.slice(0, count);
}
