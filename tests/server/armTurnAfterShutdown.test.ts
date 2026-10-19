// A file of its own: a shutdown cannot be undone inside a process.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Server as SocketServer } from "socket.io";
import { armTurn } from "../../server/game/gameTurn.ts";
import { clearRoomTimers, pending } from "../../server/game/gameTimers.ts";
import { activeGames, beginShutdown, type OnlineGameState } from "../../server/game/gameRoom.ts";
import { createDeck, emptyRankTally, type GameState } from "../../lib/game/gameEngine.ts";

const ROOM = "arm-turn-after-shutdown-room";
const io = { to: () => ({ emit: () => {} }) } as unknown as SocketServer;

test("a turn armed once the shutdown has begun arms no bot timer", (t) => {
  const deck = createDeck();
  const gameState = {
    players: [0, 1].map((s) => ({ id: `player_${s}`, name: `B${s}`, type: "bot", hand: deck.filter((_, i) => i % 2 === s) })),
    currentTurnIndex: 0,
    lastPlayedCombination: null,
    lastPlayedBy: 0,
    passCount: 0,
    gameMode: "free_for_all",
    trickWinner: null,
    roundOver: false,
    finishingOrder: [],
    firstPlayMade: false,
    startReason: { type: "start_card", playerIdx: 0 },
    playedRanks: emptyRankTally(),
  } as GameState;
  activeGames.set(ROOM, { roomId: ROOM, gameState, playerMap: {} } as unknown as OnlineGameState);
  t.after(() => {
    clearRoomTimers(ROOM);
    activeGames.delete(ROOM);
  });

  beginShutdown();
  armTurn(io, ROOM);
  assert.equal(pending("bot", ROOM), false, "a bot timer was armed during the drain");
});
