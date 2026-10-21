// lib/game/simulate.ts — a whole offline match played headless, every choice drawn from one seed.
// Test and script tooling only: nothing the app bundles imports it.
import {
  actingSeat,
  type Card,
  type GameMode,
  type GameState,
  type MatchLength,
  type RandomSource,
  type SeatSetup,
} from "./gameEngine.ts";
import { advance, dealNext, startTable } from "./matchFlow.ts";
import { autoMoveForSeat, type AutoMove } from "./autoMove.ts";

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

/** One of the six top cards: the four 2s and the two Jokers. */
export const isTopCard = (c: Card): boolean => c.isJoker || c.rank === "2";

export interface SimulatedRound {
  finishingOrder: string[];
  cumulativeAfter: Record<string, number>;
  target: number;
  /** Plays + passes + exchange choices this round took to reach `roundOver`. */
  moves: number;
  /**
   * How many top cards each seat held the moment this round's hand was set — after
   * `startRound`'s automatic loser-to-winner card (docs/GAME-RULES.md §10) for every round past
   * the first, before any card is played. The giveback leg never touches this: it is restricted
   * to ranks 3-10 (`EXCHANGE_VALID_RANKS`), so it cannot move a 2 or a Joker either way.
   */
  topCardCounts: number[];
}

export interface SimulatedMatch {
  seed: number;
  rounds: SimulatedRound[];
  target: number;
  winners: string[];
  isDraw: boolean;
}

export class MatchStallError extends Error {
  seed: number;
  rounds: SimulatedRound[];

  constructor(message: string, seed: number, rounds: SimulatedRound[]) {
    super(message);
    this.name = "MatchStallError";
    this.seed = seed;
    this.rounds = rounds;
  }
}

export interface MoveContext {
  /** The state the move was made from. */
  state: GameState;
  seat: number;
  move: AutoMove;
  roundIndex: number;
  /** 1-based count of moves this round, this one included. */
  moveIndex: number;
}

export interface SimulateOptions {
  seed: number;
  players: SeatSetup[];
  gameMode: GameMode;
  length: MatchLength;
  /** Rounds played with no match-over before this is a stall, not a long match. */
  maxRounds?: number;
  /** Moves (plays + passes + exchange choices) in one round before that round is a stall. */
  maxMovesPerRound?: number;
  /**
   * Forwarded to every bot choice (`autoMoveForSeat`'s `rng`). Absent means `Math.random`,
   * unseeded; seeded, the whole match — deal and personality knobs both — replays from `seed`.
   */
  botRng?: (seed: number) => () => number;
  /** The acting seat's move; null is a stall. Absent, every seat plays as the bot. */
  move?: (state: GameState, seat: number, botRng: (() => number) | undefined) => AutoMove | null;
  /** Every move, before it commits; a throw ends the match there. */
  onMove?: (ctx: MoveContext) => void;
  /** Each round's dealt state, before its first move. */
  onRoundStart?: (state: GameState, roundIndex: number) => void;
  /** Each round's final state, before it is scored into the match. */
  onRoundEnd?: (state: GameState, roundIndex: number) => void;
  /** Every committed state, with the one before it: a deal, then each move. `prev` is null before the first deal. */
  onTransition?: (prev: GameState | null, next: GameState) => void;
}

/**
 * Plays one full offline match — every round it takes to reach `match.over` — against the real
 * engine, match flow and bot, with no browser and no timers. Throws `MatchStallError` the moment
 * either bound is crossed, carrying the rounds already played so the caller can turn the seed
 * into a fixture.
 */
export function simulateMatch(opts: SimulateOptions): SimulatedMatch {
  const maxRounds = opts.maxRounds ?? 500;
  const maxMovesPerRound = opts.maxMovesPerRound ?? 2000;
  const choose = opts.move ?? ((state, seat, botRng) => autoMoveForSeat(state, seat, "bot", botRng));

  const random = rng(opts.seed).source;
  let table = startTable(opts.players, opts.gameMode, opts.length, { random });
  const rounds: SimulatedRound[] = [];
  const botRng = opts.botRng?.(opts.seed);
  let endOfLastRound: GameState | null = null;

  while (!table.match.over) {
    if (rounds.length >= maxRounds) {
      throw new MatchStallError(
        `match did not reach target ${table.match.target} after ${rounds.length} rounds ` +
          `(scores: ${JSON.stringify(table.match.scores)})`,
        opts.seed,
        rounds
      );
    }

    if (rounds.length > 0) table = dealNext(table, random);
    let state = table.state;
    opts.onTransition?.(endOfLastRound, state);
    opts.onRoundStart?.(state, rounds.length);
    const topCardCounts = state.players.map((p) => p.hand.filter(isTopCard).length);

    let moves = 0;
    while (!state.roundOver) {
      if (moves >= maxMovesPerRound) {
        throw new MatchStallError(
          `round ${rounds.length} did not reach roundOver after ${moves} moves ` +
            `(seats holding cards: ${state.players.map((p) => p.hand.length).join(",")})`,
          opts.seed,
          rounds
        );
      }
      moves++;
      const seat = actingSeat(state);
      const move = choose(state, seat, botRng);
      if (!move) {
        throw new MatchStallError(
          `round ${rounds.length} stuck: seat ${seat} could not act at move ${moves} ` +
            `(exchange active: ${state.exchangePhase?.kind === "open"})`,
          opts.seed,
          rounds
        );
      }
      opts.onMove?.({ state, seat, move, roundIndex: rounds.length, moveIndex: moves });
      opts.onTransition?.(state, move.state);
      state = move.state;
    }

    opts.onRoundEnd?.(state, rounds.length);
    endOfLastRound = state;
    table = advance(table, state);
    rounds.push({
      finishingOrder: state.finishingOrder,
      cumulativeAfter: table.match.scores,
      target: table.match.target,
      moves,
      topCardCounts,
    });
  }

  return {
    seed: opts.seed,
    rounds,
    target: table.match.target,
    winners: table.match.winners,
    isDraw: table.match.isDraw,
  };
}
