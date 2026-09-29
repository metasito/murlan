import { test } from "node:test";
import assert from "node:assert/strict";
import type { SocketServer } from "../../server/socket/socketTypes.ts";
import { armTurn } from "../../server/game/gameTurn.ts";
import { persistence } from "../../server/game/gamePersistence.ts";
import { activeGames, type OnlineGameState } from "../../server/game/gameRoom.ts";
import { botMoveDelayMs, clearRoomTimers } from "../../server/game/gameTimers.ts";
import { initializeRematch, type GameState } from "../../lib/game/gameEngine.ts";
import { exchangeAnnounceMs } from "../../lib/exchangeCeremony.ts";
import { RECEIVE_MS, exchangeGiveDelayMs } from "../../lib/game/exchangeTimeline.ts";
import { Motion } from "../../lib/tokens.ts";

const ROOM = "exchange-rearm-room";
const io = { to: () => ({ emit: () => {} }) } as unknown as SocketServer;

function exchangeTable(): OnlineGameState {
  const seats = [0, 1, 2, 3].map((i) => ({ name: `B${i}`, type: "ai" as const, id: `player_${i}` }));
  const gameState: GameState = initializeRematch(seats, "free_for_all", ["player_0", "player_1", "player_2", "player_3"]);
  assert.ok(gameState.exchangePhase?.active, "the rematch opens an exchange");
  const game: OnlineGameState = {
    roomId: ROOM,
    joinCode: "AAAAAA",
    playerMap: {},
    rematchVotes: new Set(),
    rematchIntents: new Map(),
    cumulativeScores: {},
    gameMode: "free_for_all",
    maxPlayers: 4,
    matchTarget: 21,
    matchLength: "match",
    handsPlayed: 1,
    matchOver: false,
    handFlags: {},
    abandonedSeats: new Map(),
    botSeatsAtStart: new Set(),
    releasedSeats: new Set(),
    vacatedSeats: new Map(),
    weakSeats: new Set(),
    endMatchVotes: new Set(),
    dealFirstSeat: 0,
    spectators: new Set(),
    moveLog: null,
    gameState,
  };
  activeGames.set(ROOM, game);
  return game;
}

test("a bot winner gives no earlier than the receive has landed and been read, and the next seat waits out the ceremony", (t) => {
  t.mock.method(persistence, "writeActiveGame", async () => {});
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const game = exchangeTable();
  try {
    const phase = game.gameState.exchangePhase!;
    armTurn(io, ROOM);
    const floor = exchangeGiveDelayMs(game.gameState.players.map((p) => p.hand.length));
    t.mock.timers.tick(floor - 1);
    assert.ok(floor >= RECEIVE_MS + Motion.exchange.read, "the floor leaves the receive its landing and read");
    assert.equal(game.gameState.exchangePhase?.active, true, "gave before the receive was read");
    t.mock.timers.tick(1);
    assert.equal(game.gameState.exchangePhase?.active ?? false, false, "the bot winner gave");
    const after = structuredClone(game.gameState);
    t.mock.timers.tick(Math.max(botMoveDelayMs(), exchangeAnnounceMs(phase.bothJokersException)) - 1);
    assert.deepEqual(game.gameState, after, "the next seat moved during the ceremony");
    t.mock.timers.tick(1);
    assert.notDeepEqual(game.gameState, after, "the next seat never moved");
  } finally {
    clearRoomTimers(ROOM);
    activeGames.delete(ROOM);
  }
});
