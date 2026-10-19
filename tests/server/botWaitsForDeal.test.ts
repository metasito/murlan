import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { Server as SocketServer } from "socket.io";

import { armTurn } from "../../server/game/gameTurn.ts";
import { botMoveDelayMs, clearRoomTimers, deadline } from "../../server/game/gameTimers.ts";
import { installClock } from "../../server/http/clock.ts";
import { fakeClock } from "../helpers/fakeClock.ts";
import { activeGames } from "../../server/game/gameRoom.ts";
import type { OnlineGameState } from "../../server/game/gameRoom.ts";
import { createDeck, emptyRankTally } from "../../lib/game/gameEngine.ts";
import type { GameState, Player } from "../../lib/game/gameEngine.ts";
import { dealEndMs } from "../../lib/timeline/dealTimeline.ts";
import { Motion } from "../../lib/tokens.ts";

let restoreClock = () => {};

const ROOM = "bot-waits-for-deal-room";
const io = { to: () => ({ emit: () => {} }) } as unknown as SocketServer;

function dealtRound(seats: number): GameState {
  const deck = createDeck();
  const players: Player[] = Array.from({ length: seats }, (_, s) => ({
    id: `player_${s}`,
    name: `B${s}`,
    type: "bot",
    hand: deck.filter((_, i) => i % seats === s),
  }));
  return {
    players,
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
  };
}

function teardown() {
  clearRoomTimers(ROOM);
  activeGames.delete(ROOM);
  restoreClock();
}

describe("a vacant opener waits out the deal (#1726)", () => {
  for (const seats of [4, 2]) {
    test(`${seats} bots, no exchange: the first play lands at dealEndMs, not botMoveDelayMs`, () => {
      const clock = fakeClock();
      restoreClock = installClock(clock);
      const gameState = dealtRound(seats);
      activeGames.set(ROOM, { roomId: ROOM, gameState, playerMap: {} } as unknown as OnlineGameState);
      try {
        armTurn(io, ROOM);
        const floor = dealEndMs(
          gameState.players.map((p) => p.hand.length),
          Motion.duration.reveal
        );
        assert.ok(floor > botMoveDelayMs(), "the deal outlasts the bot's think delay");
        assert.equal(deadline("bot", ROOM)! - clock.now(), floor);
      } finally {
        teardown();
      }
    });
  }

  test("a round already in play keeps the bot's own delay", () => {
    const clock = fakeClock();
    restoreClock = installClock(clock);
    const gameState = dealtRound(4);
    gameState.firstPlayMade = true;
    gameState.playedRanks![0] = 1;
    activeGames.set(ROOM, { roomId: ROOM, gameState, playerMap: {} } as unknown as OnlineGameState);
    try {
      armTurn(io, ROOM);
      assert.equal(deadline("bot", ROOM)! - clock.now(), botMoveDelayMs());
    } finally {
      teardown();
    }
  });
});
