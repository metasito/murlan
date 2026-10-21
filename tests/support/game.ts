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
    roundOver: false,
    finishingOrder: [],
    openingCard: null,
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

export { mulberry32, rng } from "../../scripts/headsUpBalance.ts";

/** `count` distinct cards from `deck`. */
export function sample(deck: Card[], count: number, rand: () => number): Card[] {
  const pool = [...deck];
  for (let i = pool.length - 1; i > 0; i--) {
    const k = Math.floor(rand() * (i + 1));
    [pool[i], pool[k]] = [pool[k], pool[i]];
  }
  return pool.slice(0, count);
}
