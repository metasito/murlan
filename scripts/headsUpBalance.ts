// scripts/headsUpBalance.ts — what scripts/measureHeadsUpBalance.ts plays its matches with:
// the real engine, match flow and bot, every choice drawn from one seed.
import {
  actingSeat,
  type Card,
  type GameMode,
  type GameState,
  type MatchLength,
  type RandomSource,
  type SeatSetup,
} from "../lib/game/gameEngine.ts";
import { advance, dealNext, startTable } from "../lib/game/matchFlow.ts";
import { autoMoveForSeat } from "../lib/game/autoMove.ts";

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

export interface PlayedRound {
  finishingOrder: string[];
  /** How many top cards each seat held once the round's hand was set. */
  topCardCounts: number[];
}

export interface PlayedMatch {
  rounds: PlayedRound[];
  winners: string[];
  isDraw: boolean;
}

/** One of the six top cards: the four 2s and the two Jokers. */
export const isTopCard = (c: Card) => c.isJoker || c.rank === "2";

/**
 * One match between bot seats, replayed whole from `seed`: the deals from `seed`, every bot
 * choice from `botRng(seed)`.
 */
export function playMatch(opts: {
  seed: number;
  players: SeatSetup[];
  gameMode: GameMode;
  length: MatchLength;
  botRng: (seed: number) => () => number;
  maxMovesPerRound?: number;
}): PlayedMatch {
  const maxMoves = opts.maxMovesPerRound ?? 2000;
  const random = rng(opts.seed).source;
  const botRng = opts.botRng(opts.seed);
  let table = startTable(opts.players, opts.gameMode, opts.length, { random });
  const rounds: PlayedRound[] = [];

  while (!table.match.over) {
    if (rounds.length >= 500) throw new Error(`seed ${opts.seed}: no match-over after ${rounds.length} rounds`);
    if (rounds.length > 0) table = dealNext(table, random);
    let state: GameState = table.state;
    const topCardCounts = state.players.map((p) => p.hand.filter(isTopCard).length);
    for (let moves = 0; !state.roundOver; moves++) {
      const auto = moves < maxMoves ? autoMoveForSeat(state, actingSeat(state), "bot", botRng) : null;
      if (!auto) throw new Error(`seed ${opts.seed}, round ${rounds.length}: stuck at move ${moves}`);
      state = auto.state;
    }
    table = advance(table, state);
    rounds.push({ finishingOrder: state.finishingOrder, topCardCounts });
  }

  return { rounds, winners: table.match.winners, isDraw: table.match.isDraw };
}
