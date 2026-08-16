// Shared fixtures for the engine test suite.
//
// The `.ts` extension on the import is required by Node's ESM loader when it
// type-strips these files (`node --test tests/**/*.test.ts`). The repo tsconfig
// does not set `allowImportingTsExtensions`, so the import is silenced for the
// type checker only — the imported symbols keep their real types.
// @ts-ignore
export * from "../lib/gameEngine.ts";
// @ts-ignore
import type {
  Card,
  Combination,
  GameMode,
  GameState,
  Player,
  Rank,
  Suit,
} from "../lib/gameEngine.ts";

/** A normal card. Id is rank_suit, matching createDeck(). */
export const c = (rank: Rank, suit: Suit): Card => ({
  id: `${rank}_${suit}`,
  suit,
  rank,
  isJoker: false,
});

/** A joker. */
export const j = (kind: "bw" | "colored"): Card => ({
  id: kind === "bw" ? "joker_bw" : "joker_colored",
  suit: null,
  rank: kind === "bw" ? "joker_bw" : "joker_colored",
  isJoker: true,
});

/** Stable key for a set of cards, order-insensitive. */
export const cardKey = (cards: Card[]): string =>
  cards
    .map((card) => card.id)
    .sort()
    .join(",");

export function makePlayer(
  id: string,
  hand: Card[],
  extra: Partial<Player> = {}
): Player {
  return {
    id,
    name: id,
    hand,
    type: "human",
    ...extra,
  };
}

export function makeState(
  players: Player[],
  overrides: Partial<GameState> = {}
): GameState {
  const base: GameState = {
    players,
    currentTurnIndex: 0,
    lastPlayedCombination: null,
    lastPlayedBy: 0,
    passCount: 0,
    gameMode: "free_for_all" as GameMode,
    roundWinner: null,
    gameOver: false,
    rankings: [],
    firstPlayMade: false,
  };
  return { ...base, ...overrides };
}

/** Deterministic PRNG so property-test failures are reproducible. */
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

/** Picks `count` distinct cards from `deck` using `rand`. */
export function sample(deck: Card[], count: number, rand: () => number): Card[] {
  const pool = [...deck];
  for (let i = pool.length - 1; i > 0; i--) {
    const k = Math.floor(rand() * (i + 1));
    [pool[i], pool[k]] = [pool[k], pool[i]];
  }
  return pool.slice(0, count);
}

export type { Card, Combination, GameState, Player, Rank, Suit };
