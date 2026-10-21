// Plays an offline match to completion with no browser and no UI, so
// tests/engine/matchTerminates.test.ts can assert the thing #770 found missing: that
// a match started offline always reaches `match.over`, not just that each
// round it deals resolves.
//
// A bot seat's turn is `offlineBotMove`, the function GameContext.tsx calls
// (tests/engine/matchState.test.ts pins both callers), and the deal and the
// round->match accounting are `lib/game/matchFlow.ts`, which GameContext.tsx
// drives too.
import { applyMove, type Combination, type GameState, type SeatSetup } from "../../lib/game/gameEngine.ts";
import { autoMoveForSeat, offlineBotMove, type AutoMove } from "../../lib/game/autoMove.ts";
import {
  MatchStallError,
  simulateMatch,
  type SimulatedMatch,
  type SimulatedRound,
  type SimulateOptions,
} from "../../lib/game/simulate.ts";
import { legalPlays } from "../support/moves.ts";

export { MatchStallError, type SimulatedRound };
export type SimulateMatchResult = SimulatedMatch;

export type OfflinePlayerSetup = SeatSetup;

export interface SimulateMatchOptions
  extends Pick<SimulateOptions, "seed" | "gameMode" | "length" | "maxRounds" | "maxMovesPerRound" | "botRng" | "passThrough" | "onMove" | "onTransition"> {
  players: OfflinePlayerSetup[];
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
  const { seed } = opts;
  // Every seat dealt cards must be given at least one turn before this
  // round's `roundOver` — a turn-advance that silently keeps re-picking
  // the same seat still reaches `activePlayers.length <= 1` and looks
  // like a normal finish (a winner, a plausible finishingOrder array) with the
  // other seat never once having acted.
  let dealtSeats: number[] = [];
  const actedSeats = new Set<number>();

  const move = (state: GameState, seat: number, botRng: (() => number) | undefined): AutoMove | null => {
    const isExchangeTurn = state.exchangePhase?.kind === "open";
    if (!isExchangeTurn && opts.contest?.[seat]) {
      const combo = weakestBeatingPlay(state, seat);
      const result = applyMove(state, seat, combo ? { kind: "play", cardIds: combo.cards.map((c) => c.id) } : { kind: "pass" });
      return result.ok ? result : null;
    }
    return !isExchangeTurn && state.players[seat]?.type === "bot"
      ? offlineBotMove(state, botRng)
      : autoMoveForSeat(state, seat, (opts.useBot?.[seat] ?? true) ? "bot" : "floor", botRng);
  };

  return simulateMatch({
    ...opts,
    move,
    onRoundStart: (state) => {
      dealtSeats = state.players.flatMap((p, i) => (p.hand.length > 0 ? [i] : []));
      actedSeats.clear();
    },
    onMove: (ctx) => {
      opts.onMove?.(ctx);
      const { state, seat, move: auto, roundIndex, moveIndex } = ctx;
      actedSeats.add(seat);
      // Exchange choices and the stuck-exchange release neither play nor
      // pass, and never touch `getNextActivePlayer` — out of scope for both
      // checks below.
      if (state.exchangePhase?.kind === "open") return;
      if (auto.move?.kind !== "play" && auto.move?.kind !== "pass") return;
      const next = auto.state;
      const playedCombo: Combination | null = auto.move.kind === "play" ? auto.move.combo : null;
      if (playedCombo !== null) {
        const before = state.players[seat]?.hand.length ?? 0;
        const after = next.players[seat]?.hand.length ?? 0;
        const shed = playedCombo.cards.length;
        if (after !== before - shed) {
          throw new HandNotShrunkError(
            `round ${roundIndex} move ${moveIndex}: seat ${seat} played ` +
              `${shed} card(s) but its hand went from ${before} to ${after}`,
            seed,
            roundIndex,
            seat
          );
        }
      }
      if (next.roundOver) return;
      const hands = next.players.map((p) => p.hand);
      const expected =
        next.lastMove.kind === "pass" && next.lastMove.closedTrick
          ? (next.players[next.lastPlayedBy]?.hand.length ?? 0) > 0
            ? next.lastPlayedBy
            : expectedNextActive(next.lastPlayedBy, hands)
          : expectedNextActive(seat, hands);
      if (expected !== next.currentTurnIndex) {
        throw new RotationOrderError(
          `round ${roundIndex} move ${moveIndex}: expected seat ${expected} next, ` +
            `got seat ${next.currentTurnIndex} (acting seat was ${seat}, ` +
            `${playedCombo === null ? "passed" : "played"})`,
          seed,
          roundIndex,
          moveIndex,
          expected,
          next.currentTurnIndex
        );
      }
    },
    onRoundEnd: (state, roundIndex) => {
      for (const seat of dealtSeats) {
        if (!actedSeats.has(seat)) {
          throw new SilentSeatError(
            `round ${roundIndex} ended with seat ${seat} never given a turn ` +
              `(acted: [${[...actedSeats].join(",")}], finishingOrder: ${JSON.stringify(state.finishingOrder)})`,
            seed,
            roundIndex,
            seat
          );
        }
      }
    },
  });
}
