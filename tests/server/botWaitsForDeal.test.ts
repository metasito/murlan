import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { recordingRuntime } from "../helpers/recordingRuntime.ts";

import { armTurn, armTurnIfIdle } from "../../server/game/gameTurn.ts";
import { dealRound } from "../../server/game/dealRound.ts";
import { fromEnvelope, toEnvelope } from "../../server/game/tableState.ts";
import { onlineTable } from "../helpers/onlineTable.ts";
import { botMoveDelayMs, clearRoomTimers, deadline } from "../../server/game/gameTimers.ts";
import { installClock } from "../../server/http/clock.ts";
import { fakeClock } from "../helpers/fakeClock.ts";
import { activeGames } from "../../server/game/gameRoom.ts";
import type { OnlineGameState } from "../../server/game/gameRoom.ts";
import { createDeck, emptyRankTally, startRound } from "../../lib/game/gameEngine.ts";
import type { GameState, Player } from "../../lib/game/gameEngine.ts";
import { dealEndMs } from "../../lib/timeline/dealTimeline.ts";
import { Motion } from "../../lib/tokens.ts";

let restoreClock = () => {};

const ROOM = "bot-waits-for-deal-room";
const { rt } = recordingRuntime();

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
    roundOver: false,
    finishingOrder: [],
    openingCard: null,
    lastMove: { seq: 0, kind: "deal" },
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
    test(`${seats} bots, no exchange: the first play lands at dealEndMs, then the think`, () => {
      const clock = fakeClock();
      restoreClock = installClock(clock);
      const gameState = dealtRound(seats);
      activeGames.set(ROOM, { roomId: ROOM, gameState, playerMap: {} } as unknown as OnlineGameState);
      try {
        armTurn(rt, ROOM);
        const floor = dealEndMs(
          gameState.players.map((p) => p.hand.length),
          Motion.duration.reveal
        );
        assert.ok(floor > botMoveDelayMs(), "the deal outlasts the bot's think delay");
        assert.equal(deadline("bot", ROOM)! - clock.now(), floor + botMoveDelayMs());
      } finally {
        teardown();
      }
    });
  }

  test("a round already in play keeps the bot's own delay", () => {
    const clock = fakeClock();
    restoreClock = installClock(clock);
    const gameState = dealtRound(4);
    gameState.openingCard = null;
    gameState.playedRanks![0] = 1;
    gameState.lastMove = { seq: 1, kind: "play", seat: 3 };
    activeGames.set(ROOM, { roomId: ROOM, gameState, playerMap: {} } as unknown as OnlineGameState);
    try {
      armTurn(rt, ROOM);
      assert.equal(deadline("bot", ROOM)! - clock.now(), botMoveDelayMs());
    } finally {
      teardown();
    }
  });
});

for (const intoDealMs of [1_000, 60_000]) {
  test(`a restart ${intoDealMs} ms into the deal re-arms the bot for what is left of it, then the think`, async () => {
    const clock = fakeClock();
    restoreClock = installClock(clock);
    const rows: unknown[] = [];
    const { rt: dealing, writes } = recordingRuntime({
      writers: { persistGameState: async (_roomId, game) => void rows.push(JSON.parse(JSON.stringify(toEnvelope(game)))) },
    });
    const seats = [0, 1, 2, 3].map((i) => ({ name: `B${i}`, type: "bot" as const, id: `player_${i}` }));
    const game = onlineTable({ roomId: ROOM, gameState: startRound(seats, "free_for_all") });
    activeGames.set(ROOM, game);
    try {
      await dealRound(dealing, game, startRound(seats, "free_for_all"));
      assert.equal(writes("persistGameState").length, 1, "the deal is written once, and the stamp rides that write");
      const floor = dealEndMs(
        game.gameState.players.map((p) => p.hand.length),
        Motion.duration.reveal
      );

      clearRoomTimers(ROOM);
      activeGames.delete(ROOM);
      clock.advance(intoDealMs);
      const restored = fromEnvelope({ roomId: ROOM, gameState: rows.at(-1) });
      assert.ok(restored.ok);
      activeGames.set(ROOM, restored.game);
      armTurnIfIdle(rt, ROOM);

      assert.equal(deadline("bot", ROOM)! - clock.now(), Math.max(0, floor - intoDealMs) + botMoveDelayMs());
    } finally {
      teardown();
    }
  });
}
