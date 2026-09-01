// Plays an offline match to completion with no browser and no UI, so
// tests/matchTerminates.test.ts can assert the thing #770 found missing: that
// a match started offline always reaches `match.over`, not just that each
// manche it deals resolves.
//
// This mirrors context/GameContext.tsx's own manche->match wiring
// (`applyHandToMatch`, `dealFrom`) rather than importing it: that file pulls
// in `react` and AsyncStorage, which `node --test` cannot load, and every
// other lib/*.ts here is kept free of those for the same reason. Drifting
// from GameContext.tsx would mean this harness stops proving what it claims
// to, so a change to either has to be carried to the other by hand.
import {
  foldHandIntoMatch,
  initializeGame,
  initializeRematch,
  nextDealFirstSeat,
  firstTargetFor,
  type GameMode,
  type GameState,
  type MatchLength,
  type PlayerType,
} from "../../lib/gameEngine.ts";
import { autoMoveForSeat } from "../../lib/autoMove.ts";
import { mulberry32 } from "../helpers.ts";

interface HandResult {
  rankings: string[];
  pointsAwarded: Record<string, number>;
}

interface MatchState {
  length: MatchLength;
  target: number;
  scores: Record<string, number>;
  hands: HandResult[];
  over: boolean;
  winners: string[];
  isDraw: boolean;
}

function freshMatch(length: MatchLength, playerCount: number): MatchState {
  return {
    length,
    target: firstTargetFor(playerCount),
    scores: {},
    hands: [],
    over: false,
    winners: [],
    isDraw: false,
  };
}

/** Verbatim copy of context/GameContext.tsx's `applyHandToMatch` — see the
 * file banner for why this cannot just import it. */
function applyHandToMatch(match: MatchState, finished: GameState): MatchState {
  const teamOf: Record<string, string> = {};
  for (const p of finished.players) {
    if (p.team) teamOf[p.id] = p.team;
  }

  const folded = foldHandIntoMatch({
    rankings: finished.rankings,
    playerCount: finished.players.length,
    length: match.length,
    gameMode: finished.gameMode,
    target: match.target,
    cumulative: match.scores,
    keyOf: (engineId) => engineId,
    teamOf,
  });

  return {
    ...match,
    scores: folded.cumulative,
    hands: [...match.hands, { rankings: finished.rankings, pointsAwarded: folded.handByKey }],
    target: folded.target,
    over: folded.over,
    winners: folded.winners,
    isDraw: folded.isDraw,
  };
}

/**
 * `lib/gameEngine.ts`'s `shuffleDeck` draws from `globalThis.crypto`
 * whenever it exists (Node 18+ always has it), which is unseedable. Swapping
 * in a `getRandomValues` backed by `mulberry32(seed)` for the duration of one
 * simulated match is what makes "seed 4242 stalls" a claim anyone can
 * reproduce, offline included — matching the convention `tests/helpers.ts`'s
 * own `mulberry32` comment already states for the property suite.
 */
function withSeededDeals<T>(seed: number, run: () => T): T {
  const rand = mulberry32(seed);
  const original = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  const fake = {
    getRandomValues(buf: Uint32Array) {
      for (let i = 0; i < buf.length; i++) {
        buf[i] = Math.floor(rand() * 0x100000000);
      }
      return buf;
    },
  };
  // `crypto` is a non-configurable getter in some Node builds and a plain
  // property in others — defineProperty with configurable:true covers both,
  // where a bare assignment throws on the getter-only shape.
  Object.defineProperty(globalThis, "crypto", {
    value: fake,
    configurable: true,
    writable: true,
  });
  try {
    return run();
  } finally {
    if (original) Object.defineProperty(globalThis, "crypto", original);
  }
}

export interface OfflinePlayerSetup {
  name: string;
  type: PlayerType;
  team?: "A" | "B";
}

export interface SimulateMatchOptions {
  seed: number;
  players: OfflinePlayerSetup[];
  gameMode: GameMode;
  length: MatchLength;
  /** Manches played with no match-over before this is a stall, not a long match. */
  maxManches?: number;
  /** Moves (plays + passes + exchange choices) in one manche before that manche is a stall. */
  maxMovesPerManche?: number;
  /**
   * Per-seat AI choice, indexed like `players`. Defaults to every seat using
   * the real AI (`aiChoosePlay`). `false` plays the forced-minimum move
   * instead — the same floor `autoMoveForSeat` gives an AFK human — which is
   * what a real human playing conservatively, or the e2e harness's own
   * weakest-legal-move driver, looks like to the engine.
   */
  useAi?: boolean[];
}

export interface SimulatedManche {
  rankings: string[];
  cumulativeAfter: Record<string, number>;
  target: number;
}

export interface SimulateMatchResult {
  seed: number;
  manches: SimulatedManche[];
  target: number;
  winners: string[];
  isDraw: boolean;
}

export class MatchStallError extends Error {
  seed: number;
  manches: SimulatedManche[];

  constructor(message: string, seed: number, manches: SimulatedManche[]) {
    super(message);
    this.name = "MatchStallError";
    this.seed = seed;
    this.manches = manches;
  }
}

/**
 * Plays one full offline match — every manche it takes to reach
 * `match.over` — against the real engine and the real bot AI on both seats,
 * with no browser and no timers. Throws `MatchStallError` the moment either
 * bound is crossed, carrying the manches already played so the caller can
 * turn the seed into a fixture.
 */
export function simulateOfflineMatch(opts: SimulateMatchOptions): SimulateMatchResult {
  const maxManches = opts.maxManches ?? 500;
  const maxMovesPerManche = opts.maxMovesPerManche ?? 2000;

  return withSeededDeals(opts.seed, () => {
    let match = freshMatch(opts.length, opts.players.length);
    let dealFirstSeat = 0;
    let prevRankings: string[] = [];
    const manches: SimulatedManche[] = [];

    while (!match.over) {
      if (manches.length >= maxManches) {
        throw new MatchStallError(
          `match did not reach target ${match.target} after ${manches.length} manches ` +
            `(scores: ${JSON.stringify(match.scores)})`,
          opts.seed,
          manches
        );
      }

      // Mirrors `GameContext.tsx`'s `dealFrom` exactly: it advances
      // `dealFirstSeat` *before* dealing the rematch and deals from the new
      // value, so the first rematch opens one seat past `initializeGame`'s own
      // implicit seat 0 rather than from it again.
      let state: GameState;
      if (manches.length === 0) {
        state = initializeGame(opts.players, opts.gameMode, dealFirstSeat);
      } else {
        dealFirstSeat = nextDealFirstSeat(dealFirstSeat, opts.players.length);
        state = initializeRematch(
          opts.players.map((p, i) => ({ ...p, id: `player_${i}` })),
          opts.gameMode,
          prevRankings,
          dealFirstSeat
        );
      }

      let moves = 0;
      while (!state.gameOver) {
        if (moves >= maxMovesPerManche) {
          throw new MatchStallError(
            `manche ${manches.length} did not reach gameOver after ${moves} moves ` +
              `(seats holding cards: ${state.players.map((p) => p.hand.length).join(",")})`,
            opts.seed,
            manches
          );
        }
        moves++;

        const seat = state.exchangePhase?.active
          ? state.exchangePhase.winnerIdx
          : state.currentTurnIndex;
        const useAiForSeat = opts.useAi?.[seat] ?? true;
        const next = autoMoveForSeat(state, seat, useAiForSeat, {});
        if (!next) {
          throw new MatchStallError(
            `manche ${manches.length} stuck: seat ${seat} could not act at move ${moves} ` +
              `(exchange active: ${!!state.exchangePhase?.active})`,
            opts.seed,
            manches
          );
        }
        state = next;
      }

      prevRankings = state.rankings;
      match = applyHandToMatch(match, state);
      manches.push({
        rankings: state.rankings,
        cumulativeAfter: match.scores,
        target: match.target,
      });
    }

    return {
      seed: opts.seed,
      manches,
      target: match.target,
      winners: match.winners,
      isDraw: match.isDraw,
    };
  });
}
