import { test } from "node:test";
import assert from "node:assert/strict";
import { recordingRuntime, type JournalEntry } from "../helpers/recordingRuntime.ts";
import { useMemoryTableStores } from "../helpers/memoryTableStores.ts";
import { commitMove, moveAction } from "../../server/game/tableMoves.ts";
import { activeGames, type OnlineGameState } from "../../server/game/gameRoom.ts";
import { botMoveDelayMs, clearRoomTimers, pending } from "../../server/game/gameTimers.ts";
import { applyMove, createDeck, startRound, type GameState, type Move } from "../../lib/game/gameEngine.ts";
import { card as c, seat, state as dealtState } from "../support/game.ts";
import { turnOf } from "../../lib/game/moves.ts";
import { exchangeAnnounceMs } from "../../lib/timeline/exchangeTimeline.ts";

const ROOM = "commit-move-room";
const SEATS = [0, 1, 2, 3].map((i) => ({ name: `B${i}`, type: "bot" as const, id: `player_${i}` }));

function table(gameState: GameState, playerMap: Record<number, string> = {}): OnlineGameState {
  const game: OnlineGameState = {
    roomId: ROOM,
    joinCode: "AAAAAA",
    playerMap,
    rematchVotes: new Set(),
    cumulativeScores: {},
    maxPlayers: 4,
    matchTarget: 21,
    matchLength: "match",
    roundsPlayed: 1,
    matchOver: false,
    roundFlags: {},
    abandonedSeats: new Map(),
    botSeatsAtStart: new Set(),
    releasedSeats: new Set(),
    vacatedSeats: new Map(),
    weakSeats: new Set(),
    endMatchVotes: new Set(),
    dealFirstSeat: 0,
    spectators: new Set(),
    moveLog: [],
    gameState,
  };
  activeGames.set(ROOM, game);
  return game;
}

function applied(state: GameState, move: Move) {
  const result = applyMove(state, state.currentTurnIndex, move);
  assert.ok(result.ok, `the engine refused the ${move.kind}`);
  return result;
}

const leadStartCard = (state: GameState) => applied(state, { kind: "play", cardIds: [state.openingCard!.id] });

function opened(): GameState {
  return leadStartCard(startRound(SEATS, "free_for_all")).state;
}

/** Rows that landed in the store, not writes asked for. */
const rowsWritten = (journal: JournalEntry[]) => journal.filter((e) => e.kind === "store" && e.name === "write").length;

const writesSettle = () => new Promise((resolve) => setImmediate(resolve));

/** Persists, logs `logged` replay moves, and leaves the next seat waiting exactly `delayMs`. */
async function assertCommitted(
  t: { mock: { timers: { tick(ms: number): void } } },
  game: OnlineGameState,
  persists: () => number,
  logged: number,
  delayMs: number
) {
  await writesSettle();
  assert.equal(persists(), 1, "the move was not persisted once");
  assert.equal(game.moveLog?.length, logged, "the replay log holds the wrong number of moves");
  assert.ok(pending("bot", ROOM), "the next seat was not armed");
  const after = structuredClone(game.gameState);
  t.mock.timers.tick(delayMs - 1);
  assert.deepEqual(game.gameState, after, "the next seat moved before its delay");
  t.mock.timers.tick(1);
  assert.notDeepEqual(game.gameState, after, "the armed bot never moved");
  await writesSettle();
  assert.equal(persists(), 2, "the bot's move was not persisted once");
  assert.equal(game.moveLog?.length, logged + 1, "the bot's move was not logged exactly once");
}

for (const kind of ["play", "pass"] as const) {
  test(`a ${kind} is logged once, persisted and re-armed at the ordinary bot delay`, async (t) => {
    useMemoryTableStores(t);
    const { rt, journal } = recordingRuntime({ persist: "real" });
    const persists = () => rowsWritten(journal);
    t.mock.timers.enable({ apis: ["setTimeout"] });
    try {
      if (kind === "play") {
        const fresh = startRound(SEATS, "free_for_all");
        const game = table(fresh);
        const over = commitMove(rt, game, leadStartCard(fresh));
        assert.equal(over, undefined, "a play that leaves the round open hands nothing to round over");
        await assertCommitted(t, game, persists, 1, botMoveDelayMs());
      } else {
        const state = opened();
        const game = table(state);
        commitMove(rt, game, applied(state, { kind: "pass" }));
        await assertCommitted(t, game, persists, 1, botMoveDelayMs());
      }
    } finally {
      clearRoomTimers(ROOM);
      activeGames.delete(ROOM);
    }
  });
}

test("a play that ends the round is logged, persisted, and handed to round over instead of arming a seat", async (t) => {
  useMemoryTableStores(t);
  const { rt, journal } = recordingRuntime({ persist: "real" });
  try {
    const dealt = startRound(SEATS.slice(0, 2), "free_for_all");
    const state = structuredClone(dealt);
    state.players[dealt.currentTurnIndex].hand = [state.openingCard!];
    const last = leadStartCard(state);
    assert.equal(last.state.roundOver, true, "emptying the last hand of two ends the round");
    const game = table(state);
    const over = commitMove(rt, game, last);
    assert.ok(over instanceof Promise, "the round-over handoff was not returned");
    assert.equal(pending("bot", ROOM), false, "a seat was armed on a finished round");
    await over;
    await writesSettle();
    assert.ok(rowsWritten(journal) >= 1, "the final move was never persisted");
    assert.equal(game.moveLog?.length, 1, "the final move was not logged once");
    assert.ok(last.move.kind === "play");
    assert.deepEqual(game.moveLog![0].combo, last.move.combo, "the log holds a different play than the one applied");
    assert.equal(game.moveLog![0].seat, last.move.seat);
  } finally {
    clearRoomTimers(ROOM);
    activeGames.delete(ROOM);
  }
});

test("an exchange logs no replay move, persists, and holds the next seat for the ceremony", async (t) => {
  useMemoryTableStores(t);
  const { rt, journal } = recordingRuntime({ persist: "real" });
  const persists = () => rowsWritten(journal);
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  try {
    const deck = createDeck();
    const hands = SEATS.map((_, s) => deck.filter((_, i) => i % SEATS.length === s));
    const state = startRound(SEATS, "free_for_all", {
      opening: { kind: "exchange", winnerSeat: 0, loserSeat: SEATS.length - 1 },
      dealt: hands,
    });
    const phase = state.exchangePhase;
    assert.ok(phase?.kind === "open");
    const game = table(state);
    const give = state.players[phase.winnerIdx].hand.find((c) => c.id !== phase.cardFromLoser.id)!;
    commitMove(rt, game, applied(state, { kind: "giveback", cardId: give.id }));
    await assertCommitted(t, game, persists, 0, exchangeAnnounceMs(false) + botMoveDelayMs());
  } finally {
    clearRoomTimers(ROOM);
    activeGames.delete(ROOM);
  }
});

/** Seat 0 on move with `hand`, leading a trick on a table of two. */
function leading(hand: ReturnType<typeof c>[]): GameState {
  return dealtState({
    players: [seat(0, hand), seat(1, [c("4", "clubs")])],
    currentTurnIndex: 0,
    lastPlayedCombination: null,
  });
}

test("a bomb is flagged for its seat, and an ordinary play is not", async (t) => {
  useMemoryTableStores(t);
  const { rt } = recordingRuntime({ persist: "real" });
  try {
    const bomb = leading([c("7", "spades"), c("7", "hearts"), c("7", "clubs"), c("7", "diamonds"), c("9", "clubs")]);
    const bombed = table(bomb);
    commitMove(rt, bombed, applied(bomb, { kind: "play", cardIds: ["7_spades", "7_hearts", "7_clubs", "7_diamonds"] }));
    assert.deepEqual(bombed.roundFlags, { 0: { bomb: true, joker: false } });

    const single = leading([c("9", "clubs"), c("K", "clubs")]);
    const plain = table(single);
    commitMove(rt, plain, applied(single, { kind: "play", cardIds: ["9_clubs"] }));
    assert.deepEqual(plain.roundFlags, { 0: { bomb: false, joker: false } });
  } finally {
    clearRoomTimers(ROOM);
    activeGames.delete(ROOM);
  }
});

test("a pass is logged for replay as a pass: no cards, by its seat", async (t) => {
  useMemoryTableStores(t);
  const { rt } = recordingRuntime({ persist: "real" });
  try {
    const state = opened();
    const game = table(state);
    const passing = state.currentTurnIndex;
    commitMove(rt, game, applied(state, { kind: "pass" }));
    assert.equal(game.moveLog?.length, 1);
    assert.equal(game.moveLog![0].combo, null);
    assert.equal(game.moveLog![0].seat, passing);
  } finally {
    clearRoomTimers(ROOM);
    activeGames.delete(ROOM);
  }
});

test("a move that ends the round is acknowledged ok once the round has been handed over", async (t) => {
  useMemoryTableStores(t);
  const { rt } = recordingRuntime({ persist: "real" });
  try {
    const state = leading([c("9", "clubs")]);
    const game = table(state, { 0: "u0", 1: "u1" });
    const outcome = await moveAction(rt, game, {
      kind: "move",
      id: "intent-1",
      roomId: ROOM,
      userId: "u0",
      move: { kind: "play", cardIds: ["9_clubs"] },
      turn: turnOf(state),
    });
    assert.deepEqual(outcome, { ok: true });
    assert.equal(game.gameState.roundOver, true);
    assert.equal(game.lastRoundOverPayload?.matchOver, false);
    assert.deepEqual(game.lastRoundOverPayload?.finishingOrder, ["p0", "p1"]);
  } finally {
    clearRoomTimers(ROOM);
    activeGames.delete(ROOM);
  }
});
