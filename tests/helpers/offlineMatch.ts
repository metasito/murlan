// Plays an offline match to completion with no browser and no UI, so
// tests/engine/matchTerminates.test.ts can assert the thing #770 found missing: that
// a match started offline always reaches `match.over`, not just that each
// round it deals resolves.
//
// A bot seat's turn is `offlineBotMove`, the function GameContext.tsx calls
// (tests/engine/matchState.test.ts pins both callers), and the deal and the
// round->match accounting are `lib/game/matchFlow.ts`, which GameContext.tsx
// drives too.
import {
  actingSeat,
  applyMove,
  type Combination,
  type GameMode,
  type GameState,
  type MatchLength,
  type SeatSetup,
} from "../../lib/game/gameEngine.ts";
import { advance, dealNext, startTable } from "../../lib/game/matchFlow.ts";
import { autoMoveForSeat, offlineBotMove, type AutoMove } from "../../lib/game/autoMove.ts";
import { rng } from "../support/game.ts";
import { legalPlays } from "../support/moves.ts";

export type OfflinePlayerSetup = SeatSetup;

export interface SimulateMatchOptions {
  seed: number;
  players: OfflinePlayerSetup[];
  gameMode: GameMode;
  length: MatchLength;
  /** Rounds played with no match-over before this is a stall, not a long match. */
  maxRounds?: number;
  /** Moves (plays + passes + exchange choices) in one round before that round is a stall. */
  maxMovesPerRound?: number;
  /**
   * Per-seat bot choice for a seat that is not `"bot"` (a bot seat always plays
   * through `offlineBotMove`), indexed like `players`. Defaults to the real
   * Bot (`botChoosePlay`). `false` plays the forced-minimum move
   * instead — the floor `autoMoveForSeat` gives an AFK human, which always
   * passes once it is not leading a round (`lib/game/autoMove.ts`). That is not
   * what an engaged human or `tests/e2e/helpers/bot.ts`'s own bot look like:
   * both actively try to beat the table before passing. `contest` below is
   * that shape instead.
   */
  useBot?: boolean[];
  /**
   * Per-seat, indexed like `players`. `true` plays the weakest legal
   * combination that beats the table (singles before bigger shapes, lowest
   * strength first), falling back to a pass only when nothing beats it —
   * `tests/e2e/helpers/bot.ts`'s `playOrPass` search order, without the DOM.
   * Takes priority over `useBot` for that seat; unset seats keep using `useBot`.
   */
  contest?: boolean[];
  /**
   * Forwarded to every bot seat's `botChoosePlay` call (`lib/game/autoMove.ts`'s
   * `rng` parameter). Absent means that function's own default —
   * `Math.random`, unseeded. A caller measuring outcomes across many seeds
   * (rather than only checking that a match terminates) wants this seeded
   * too, so the whole match — deal and personality knobs both — replays from
   * `seed` alone.
   */
  botRng?: (seed: number) => () => number;
  /** Every committed state, with the one before it: a deal, then each move. `prev` is null before the first deal. */
  onTransition?: (prev: GameState | null, next: GameState) => void;
}

export interface SimulatedRound {
  finishingOrder: string[];
  cumulativeAfter: Record<string, number>;
  target: number;
  /** Plays + passes + exchange choices this round took to reach `roundOver`. */
  moves: number;
  /**
   * How many of the six top cards (the four 2s and two Jokers) each seat held
   * the moment this round's hand was set — after `startRound`'s
   * automatic loser-to-winner card (docs/GAME-RULES.md §10) for every round past
   * the first, before any card is played. The giveback leg never touches this:
   * it is restricted to ranks 3-10 (`EXCHANGE_VALID_RANKS`), so it cannot move
   * a 2 or a Joker either way.
   */
  topCardCounts: number[];
}

export interface SimulateMatchResult {
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

/**
 * A round ended with a seat that was dealt cards never once given a turn —
 * the shape of a turn-advance no-op (one seat plays its whole hand alone
 * while `activePlayers.length <= 1` still reads as a normal finish). A
 * winner existing is not enough evidence a match played fairly.
 */
export class SilentSeatError extends Error {
  seed: number;
  roundIndex: number;
  seat: number;

  constructor(message: string, seed: number, roundIndex: number, seat: number) {
    super(message);
    this.name = "SilentSeatError";
    this.seed = seed;
    this.roundIndex = roundIndex;
    this.seat = seat;
  }
}

/**
 * A turn landed on a seat other than the one `getNextActivePlayer`'s own
 * contract — decrement from the acting seat, skip empty hands — promises.
 * Reimplemented independently below (`expectedNextActive`) rather than
 * imported: importing `getNextActivePlayer` would
 * let a bug inside it grade its own homework.
 */
export class RotationOrderError extends Error {
  seed: number;
  roundIndex: number;
  moveIndex: number;
  expectedSeat: number;
  actualSeat: number;

  constructor(
    message: string,
    seed: number,
    roundIndex: number,
    moveIndex: number,
    expectedSeat: number,
    actualSeat: number
  ) {
    super(message);
    this.name = "RotationOrderError";
    this.seed = seed;
    this.roundIndex = roundIndex;
    this.moveIndex = moveIndex;
    this.expectedSeat = expectedSeat;
    this.actualSeat = actualSeat;
  }
}

/** `getNextActivePlayer`'s contract (lib/game/gameEngine.ts), reimplemented from
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
 * silently discarded. Checked the instant it happens, not after a round
 * fails to end: a seat can be given turns forever while never once actually
 * shedding a card, which reaches `activePlayers.length <= 1` on nobody.
 */
export class HandNotShrunkError extends Error {
  seed: number;
  roundIndex: number;
  seat: number;

  constructor(message: string, seed: number, roundIndex: number, seat: number) {
    super(message);
    this.name = "HandNotShrunkError";
    this.seed = seed;
    this.roundIndex = roundIndex;
    this.seat = seat;
  }
}

/** `SimulateMatchOptions.contest`'s move: the weakest legal beating
 * combination, or null to pass. Exported so `tests/engine/offlineMatchContestPlay.test.ts`
 * can pin the ordering directly — a soak asserting only that a match ends
 * cannot tell "weakest" from "strongest legal beating combination" apart. */
export function weakestBeatingPlay(state: GameState, seat: number): Combination | null {
  const plays = legalPlays(state, seat);
  if (plays.length === 0) return null;
  return [...plays].sort((a, b) => a.cards.length - b.cards.length || a.strength - b.strength)[0];
}

/**
 * Plays one full offline match — every round it takes to reach
 * `match.over` — against the real engine and the real bot on both seats,
 * with no browser and no timers. Throws `MatchStallError` the moment either
 * bound is crossed, carrying the rounds already played so the caller can
 * turn the seed into a fixture.
 */
export function simulateOfflineMatch(opts: SimulateMatchOptions): SimulateMatchResult {
  const maxRounds = opts.maxRounds ?? 500;
  const maxMovesPerRound = opts.maxMovesPerRound ?? 2000;

  // One stream for every deal of the match, so a seed replays the whole of it.
  const random = rng(opts.seed).source;
  let table = startTable(opts.players, opts.gameMode, opts.length, { random });
  const rounds: SimulatedRound[] = [];
  const botRng = opts.botRng?.(opts.seed);
  let endOfLastRound: GameState | null = null;
  const topCardCount = (hand: { rank: string }[]) =>
    hand.filter((c) => c.rank === "2" || c.rank === "joker_bw" || c.rank === "joker_colored").length;

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

    const topCardCounts = state.players.map((p) => topCardCount(p.hand));

    // Every seat dealt cards must be given at least one turn before this
    // round's `roundOver` — a turn-advance that silently keeps re-picking
    // the same seat still reaches `activePlayers.length <= 1` and looks
    // like a normal finish (a winner, a plausible finishingOrder array) with the
    // other seat never once having acted.
    const dealtSeats = state.players
      .map((p, i) => ({ i, dealt: p.hand.length > 0 }))
      .filter((s) => s.dealt)
      .map((s) => s.i);
    const actedSeats = new Set<number>();

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

      const isExchangeTurn = state.exchangePhase?.kind === "open";
      const seat = actingSeat(state);
      actedSeats.add(seat);
      let auto: AutoMove | null;
      if (!isExchangeTurn && opts.contest?.[seat]) {
        const combo = weakestBeatingPlay(state, seat);
        const result = applyMove(
          state,
          seat,
          combo ? { kind: "play", cardIds: combo.cards.map((c) => c.id) } : { kind: "pass" }
        );
        auto = result.ok ? result : null;
      } else {
        auto =
          !isExchangeTurn && state.players[seat]?.type === "bot"
            ? offlineBotMove(state, botRng)
            : autoMoveForSeat(state, seat, (opts.useBot?.[seat] ?? true) ? "bot" : "floor", botRng);
      }
      if (!auto) {
        throw new MatchStallError(
          `round ${rounds.length} stuck: seat ${seat} could not act at move ${moves} ` +
            `(exchange active: ${isExchangeTurn})`,
          opts.seed,
          rounds
        );
      }

      // Exchange choices and the stuck-exchange release neither play nor
      // pass, and never touch `getNextActivePlayer` — out of scope for both
      // checks below.
      const next: GameState = auto.state;
      const comboSeen = auto.move?.kind === "play" || auto.move?.kind === "pass";
      const playedCombo: Combination | null = auto.move?.kind === "play" ? auto.move.combo : null;
      if (!isExchangeTurn && comboSeen) {
        if (playedCombo !== null) {
          const before = state.players[seat]?.hand.length ?? 0;
          const after = next.players[seat]?.hand.length ?? 0;
          const shed = playedCombo.cards.length;
          if (after !== before - shed) {
            throw new HandNotShrunkError(
              `round ${rounds.length} move ${moves}: seat ${seat} played ` +
                `${shed} card(s) but its hand went from ${before} to ${after}`,
              opts.seed,
              rounds.length,
              seat
            );
          }
        }

        if (!next.roundOver) {
          const hands = next.players.map((p) => p.hand);
          const expected =
            next.lastMove.kind === "pass" && next.lastMove.closedTrick
              ? (next.players[next.lastPlayedBy]?.hand.length ?? 0) > 0
                ? next.lastPlayedBy
                : expectedNextActive(next.lastPlayedBy, hands)
              : expectedNextActive(seat, hands);
          if (expected !== next.currentTurnIndex) {
            throw new RotationOrderError(
              `round ${rounds.length} move ${moves}: expected seat ${expected} next, ` +
                `got seat ${next.currentTurnIndex} (acting seat was ${seat}, ` +
                `${playedCombo === null ? "passed" : "played"})`,
              opts.seed,
              rounds.length,
              moves,
              expected,
              next.currentTurnIndex
            );
          }
        }
      }

      opts.onTransition?.(state, next);
      state = next;
    }

    for (const seat of dealtSeats) {
      if (!actedSeats.has(seat)) {
        throw new SilentSeatError(
          `round ${rounds.length} ended with seat ${seat} never given a turn ` +
            `(acted: [${[...actedSeats].join(",")}], finishingOrder: ${JSON.stringify(state.finishingOrder)})`,
          opts.seed,
          rounds.length,
          seat
        );
      }
    }

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
