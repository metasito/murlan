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
  getAllValidPlays,
  processPlay,
  processPass,
  type Combination,
  type GameMode,
  type GameState,
  type MatchLength,
  type PlayerType,
} from "../../lib/gameEngine.ts";
import { autoMoveForSeat } from "../../lib/autoMove.ts";
import { comboKey } from "../../components/gameTableModel.ts";
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
   * instead — the floor `autoMoveForSeat` gives an AFK human, which always
   * passes once it is not leading a round (`lib/autoMove.ts`). That is not
   * what an engaged human or `tests/e2e/helpers/bot.ts`'s own bot look like:
   * both actively try to beat the table before passing. `contest` below is
   * that shape instead.
   */
  useAi?: boolean[];
  /**
   * Per-seat, indexed like `players`. `true` plays the weakest legal
   * combination that beats the table (singles before bigger shapes, lowest
   * strength first), falling back to a pass only when nothing beats it —
   * `tests/e2e/helpers/bot.ts`'s `playOrPass` search order, without the DOM.
   * Takes priority over `useAi` for that seat; unset seats keep using `useAi`.
   */
  contest?: boolean[];
  /**
   * Collects every `computeAiTurnKey` collision found while playing, instead
   * of stopping at the first one — so a soak run can report how many turned
   * up across the whole search rather than only the first.
   */
  collectAiTurnKeyCollisions?: AiTurnKeyCollision[];
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
  /** How many non-null `aiTurnKey` states this match's run checked for a collision. */
  aiTurnKeyChecks: number;
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
 * A manche ended with a seat that was dealt cards never once given a turn —
 * the shape of a turn-advance no-op (one seat plays its whole hand alone
 * while `activePlayers.length <= 1` still reads as a normal finish). A
 * winner existing is not enough evidence a match played fairly.
 */
export class SilentSeatError extends Error {
  seed: number;
  mancheIndex: number;
  seat: number;

  constructor(message: string, seed: number, mancheIndex: number, seat: number) {
    super(message);
    this.name = "SilentSeatError";
    this.seed = seed;
    this.mancheIndex = mancheIndex;
    this.seat = seat;
  }
}

/**
 * A turn landed on a seat other than the one `getNextActivePlayer`'s own
 * contract — decrement from the acting seat, skip empty hands — promises.
 * Reimplemented independently below (`expectedNextActive`) rather than
 * imported: `getNextActivePlayer` is not exported, and importing it would
 * let a bug inside it grade its own homework.
 */
export class RotationOrderError extends Error {
  seed: number;
  mancheIndex: number;
  moveIndex: number;
  expectedSeat: number;
  actualSeat: number;

  constructor(
    message: string,
    seed: number,
    mancheIndex: number,
    moveIndex: number,
    expectedSeat: number,
    actualSeat: number
  ) {
    super(message);
    this.name = "RotationOrderError";
    this.seed = seed;
    this.mancheIndex = mancheIndex;
    this.moveIndex = moveIndex;
    this.expectedSeat = expectedSeat;
    this.actualSeat = actualSeat;
  }
}

/** `getNextActivePlayer`'s contract (lib/gameEngine.ts), reimplemented from
 * scratch: decrement from `fromSeat`, skipping any seat holding no cards. */
function expectedNextActive(fromSeat: number, hands: { length: number }[]): number {
  const total = hands.length;
  let next = (fromSeat - 1 + total) % total;
  let attempts = 0;
  while (hands[next].length === 0 && attempts < total) {
    next = (next - 1 + total) % total;
    attempts++;
  }
  return next;
}

/**
 * A seat played a combination and did not lose exactly that many cards from
 * its hand — the shape of a play the engine accepted (the turn moved on) but
 * silently discarded. Checked the instant it happens, not after a manche
 * fails to end: a seat can be given turns forever while never once actually
 * shedding a card, which reaches `activePlayers.length <= 1` on nobody.
 */
export class HandNotShrunkError extends Error {
  seed: number;
  mancheIndex: number;
  seat: number;

  constructor(message: string, seed: number, mancheIndex: number, seat: number) {
    super(message);
    this.name = "HandNotShrunkError";
    this.seed = seed;
    this.mancheIndex = mancheIndex;
    this.seat = seat;
  }
}

/**
 * `app/game.tsx`'s own key for "does the AI turn effect need to reschedule",
 * reproduced exactly: seat, pass count, and the table's last combination —
 * gated on `!gameOver`, `!exchangePhase.active` and the acting seat being
 * `"ai"`, matching that file's `aiTurnKey`. `exchangeAnnouncing` is not
 * modelled (this harness never renders a ceremony) — treating it as always
 * false only *adds* candidate collisions the real app's extra null would
 * break, so it cannot hide one that exists.
 */
function computeAiTurnKey(state: GameState): string | null {
  if (state.gameOver) return null;
  if (state.exchangePhase?.active) return null;
  const player = state.players[state.currentTurnIndex];
  if (!player || player.type !== "ai") return null;
  const combo = state.lastPlayedCombination
    ? comboKey(state.lastPlayedCombination, state.lastPlayedBy)
    : "-";
  return `${state.currentTurnIndex}|${state.passCount}|${combo}`;
}

/** Everything the key leaves out — if this differs while the key doesn't,
 * a real render would skip the reschedule a new AI decision needs. */
function handFingerprint(state: GameState): string {
  return state.players.map((p) => p.hand.map((c) => c.id).join(",")).join("|");
}

/** `SimulateMatchOptions.contest`'s move: the weakest legal beating
 * combination, or null to pass. */
function weakestBeatingPlay(state: GameState, seat: number): Combination | null {
  const player = state.players[seat];
  const isNewRound = state.lastPlayedCombination === null;
  const startCard = !state.firstPlayMade ? state.startCard : undefined;
  const requireCard = startCard ? player.hand.find((c) => c.id === startCard.id) : undefined;
  const plays = getAllValidPlays(player.hand, isNewRound ? null : state.lastPlayedCombination, isNewRound, requireCard);
  if (plays.length === 0) return null;
  return [...plays].sort((a, b) => a.cards.length - b.cards.length || a.strength - b.strength)[0];
}

export interface AiTurnKeyCollision {
  seed: number;
  mancheIndex: number;
  key: string;
  before: { fingerprint: string; state: GameState };
  after: { fingerprint: string; state: GameState };
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
    let aiTurnKeyChecks = 0;

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

      // Every seat dealt cards must be given at least one turn before this
      // manche's `gameOver` — a turn-advance that silently keeps re-picking
      // the same seat still reaches `activePlayers.length <= 1` and looks
      // like a normal finish (a winner, a plausible rankings array) with the
      // other seat never once having acted.
      const dealtSeats = state.players
        .map((p, i) => ({ i, dealt: p.hand.length > 0 }))
        .filter((s) => s.dealt)
        .map((s) => s.i);
      const actedSeats = new Set<number>();

      // `app/game.tsx`'s `aiTurnKey`, reset per manche because that screen
      // remounts on every navigation to /game (a fresh component instance
      // has no previous effect value to compare against) — see
      // `computeAiTurnKey`'s own comment for what this is chasing.
      let lastAiTurnKey: string | null = null;
      let lastAiTurnFingerprint: string | null = null;
      let lastAiTurnState: GameState | null = null;

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

        const key = computeAiTurnKey(state);
        if (key !== null) {
          aiTurnKeyChecks++;
          const fingerprint = handFingerprint(state);
          if (key === lastAiTurnKey && fingerprint !== lastAiTurnFingerprint && lastAiTurnState) {
            opts.collectAiTurnKeyCollisions?.push({
              seed: opts.seed,
              mancheIndex: manches.length,
              key,
              before: { fingerprint: lastAiTurnFingerprint!, state: lastAiTurnState },
              after: { fingerprint, state },
            });
          }
          lastAiTurnKey = key;
          lastAiTurnFingerprint = fingerprint;
          lastAiTurnState = state;
        } else {
          lastAiTurnKey = null;
          lastAiTurnFingerprint = null;
          lastAiTurnState = null;
        }

        const isExchangeTurn = !!state.exchangePhase?.active;
        const seat = isExchangeTurn ? state.exchangePhase!.winnerIdx : state.currentTurnIndex;
        actedSeats.add(seat);
        let playedCombo: Combination | null = null;
        let comboSeen = false;
        let next: GameState | null;
        if (!isExchangeTurn && opts.contest?.[seat]) {
          const combo = weakestBeatingPlay(state, seat);
          comboSeen = true;
          playedCombo = combo;
          next = combo ? processPlay(state, combo) : processPass(state);
        } else {
          const useAiForSeat = opts.useAi?.[seat] ?? true;
          next = autoMoveForSeat(state, seat, useAiForSeat, {
            onMove: (_s, combo) => {
              comboSeen = true;
              playedCombo = combo;
            },
          });
        }
        if (!next) {
          throw new MatchStallError(
            `manche ${manches.length} stuck: seat ${seat} could not act at move ${moves} ` +
              `(exchange active: ${isExchangeTurn})`,
            opts.seed,
            manches
          );
        }

        // Exchange choices and the stuck-exchange release neither play nor
        // pass in `processPlay`/`processPass`'s sense (`onMove` never fires
        // for them) and never touch `getNextActivePlayer` — out of scope for
        // both checks below.
        if (!isExchangeTurn && comboSeen) {
          if (playedCombo !== null) {
            const before = state.players[seat]?.hand.length ?? 0;
            const after = next.players[seat]?.hand.length ?? 0;
            const shed = (playedCombo as Combination).cards.length;
            if (after !== before - shed) {
              throw new HandNotShrunkError(
                `manche ${manches.length} move ${moves}: seat ${seat} played ` +
                  `${shed} card(s) but its hand went from ${before} to ${after}`,
                opts.seed,
                manches.length,
                seat
              );
            }
          }

          if (!next.gameOver) {
            const hands = next.players.map((p) => p.hand);
            const expected =
              playedCombo === null && next.roundWinner !== null
                ? (next.players[next.lastPlayedBy]?.hand.length ?? 0) > 0
                  ? next.lastPlayedBy
                  : expectedNextActive(next.lastPlayedBy, hands)
                : expectedNextActive(seat, hands);
            if (expected !== next.currentTurnIndex) {
              throw new RotationOrderError(
                `manche ${manches.length} move ${moves}: expected seat ${expected} next, ` +
                  `got seat ${next.currentTurnIndex} (acting seat was ${seat}, ` +
                  `${playedCombo === null ? "passed" : "played"})`,
                opts.seed,
                manches.length,
                moves,
                expected,
                next.currentTurnIndex
              );
            }
          }
        }

        state = next;
      }

      for (const seat of dealtSeats) {
        if (!actedSeats.has(seat)) {
          throw new SilentSeatError(
            `manche ${manches.length} ended with seat ${seat} never given a turn ` +
              `(acted: [${[...actedSeats].join(",")}], rankings: ${JSON.stringify(state.rankings)})`,
            opts.seed,
            manches.length,
            seat
          );
        }
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
      aiTurnKeyChecks,
    };
  });
}
