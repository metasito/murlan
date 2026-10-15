import { test } from "node:test";
import assert from "node:assert/strict";
import type { SocketServer } from "../../server/socket/socketTypes.ts";
import { commitMove } from "../../server/game/gameTurn.ts";
import { persistence } from "../../server/game/gamePersistence.ts";
import { startReplayLog } from "../../server/game/replayShape.ts";
import { activeGames, type OnlineGameState } from "../../server/game/gameRoom.ts";
import { botMoveDelayMs, botTimers, clearRoomTimers } from "../../server/game/gameTimers.ts";
import {
  checkPlay,
  createDeck,
  initializeGame,
  initializeRematch,
  processExchangeChoice,
  processPass,
  processPlay,
  type GameState,
} from "../../lib/game/gameEngine.ts";
import { exchangeAnnounceMs } from "../../lib/exchangeCeremony.ts";

const ROOM = "commit-move-room";
const io = { to: () => ({ emit: () => {} }) } as unknown as SocketServer;
const SEATS = [0, 1, 2, 3].map((i) => ({ name: `B${i}`, type: "bot" as const, id: `player_${i}` }));

function table(gameState: GameState): OnlineGameState {
  const game: OnlineGameState = {
    roomId: ROOM,
    joinCode: "AAAAAA",
    playerMap: {},
    rematchVotes: new Set(),
    cumulativeScores: {},
    gameMode: "free_for_all",
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
    moveLog: startReplayLog(),
    gameState,
  };
  activeGames.set(ROOM, game);
  return game;
}

function opened(): GameState {
  const state = initializeGame(SEATS, "free_for_all");
  const check = checkPlay(state, state.currentTurnIndex, [state.startCard!.id]);
  assert.ok(check.ok, "the opener can lead the start card alone");
  return processPlay(state, check.combo);
}

const writesSettle = () => new Promise((resolve) => setImmediate(resolve));

/** Persists, logs `logged` replay moves, and leaves the next seat waiting exactly `delayMs`. */
async function assertCommitted(
  t: { mock: { timers: { tick(ms: number): void } } },
  game: OnlineGameState,
  writes: { mock: { callCount(): number } },
  logged: number,
  delayMs: number
) {
  await writesSettle();
  assert.equal(writes.mock.callCount(), 1, "the move was not persisted once");
  assert.equal(game.moveLog?.length, logged, "the replay log holds the wrong number of moves");
  assert.ok(botTimers.has(ROOM), "the next seat was not armed");
  const after = structuredClone(game.gameState);
  t.mock.timers.tick(delayMs - 1);
  assert.deepEqual(game.gameState, after, "the next seat moved before its delay");
  t.mock.timers.tick(1);
  assert.notDeepEqual(game.gameState, after, "the armed bot never moved");
  await writesSettle();
  assert.equal(writes.mock.callCount(), 2, "the bot's move was not persisted once");
  assert.equal(game.moveLog?.length, logged + 1, "the bot's move was not logged exactly once");
}

for (const kind of ["play", "pass"] as const) {
  test(`a ${kind} is logged once, persisted and re-armed at the ordinary bot delay`, async (t) => {
    const writes = t.mock.method(persistence, "writeActiveGame", async () => {});
    t.mock.timers.enable({ apis: ["setTimeout"] });
    try {
      if (kind === "play") {
        const fresh = initializeGame(SEATS, "free_for_all");
        const seat = fresh.currentTurnIndex;
        const check = checkPlay(fresh, seat, [fresh.startCard!.id]);
        assert.ok(check.ok);
        const game = table(fresh);
        const over = commitMove(io, game, processPlay(fresh, check.combo), { seat, combo: check.combo });
        assert.equal(over, undefined, "a play that leaves the round open hands nothing to round over");
        await assertCommitted(t, game, writes, 1, botMoveDelayMs());
      } else {
        const state = opened();
        const game = table(state);
        commitMove(io, game, processPass(state), { seat: state.currentTurnIndex, combo: null });
        await assertCommitted(t, game, writes, 1, botMoveDelayMs());
      }
    } finally {
      clearRoomTimers(ROOM);
      activeGames.delete(ROOM);
    }
  });
}

test("an exchange logs no replay move, persists, and holds the next seat for the ceremony", async (t) => {
  const writes = t.mock.method(persistence, "writeActiveGame", async () => {});
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const deck = createDeck();
    const hands = SEATS.map((_, s) => deck.filter((_, i) => i % SEATS.length === s));
    const state = initializeRematch(SEATS, "free_for_all", SEATS.map((s) => s.id), 0, hands);
    const phase = state.exchangePhase!;
    assert.equal(phase.active, true);
    const game = table(state);
    const give = state.players[phase.winnerIdx].hand.find((c) => c.id !== phase.cardFromLoser?.id)!;
    commitMove(io, game, processExchangeChoice(state, give.id), null);
    await assertCommitted(t, game, writes, 0, Math.max(botMoveDelayMs(), exchangeAnnounceMs(phase.twoJokerException === true)));
  } finally {
    clearRoomTimers(ROOM);
    activeGames.delete(ROOM);
  }
});
