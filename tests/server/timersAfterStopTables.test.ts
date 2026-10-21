// A file of its own: stopping the tables cannot be undone inside a process.
import { test } from "node:test";
import assert from "node:assert/strict";
import { recordingRuntime } from "../helpers/recordingRuntime.ts";
import { armTurn } from "../../server/game/gameTurn.ts";
import { arm, clearRoomTimers, pending, TIMER_KINDS } from "../../server/game/gameTimers.ts";
import { activeGames, type OnlineGameState } from "../../server/game/gameRoom.ts";
import { createDeck, emptyRankTally, type GameState } from "../../lib/game/gameEngine.ts";

const ROOM = "timers-after-stop-tables-room";

test("once the tables are stopped, no timer of any kind is armed", async (t) => {
  const deck = createDeck();
  const gameState = {
    players: [0, 1].map((s) => ({ id: `player_${s}`, name: `B${s}`, type: "bot", hand: deck.filter((_, i) => i % 2 === s) })),
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
  } as GameState;
  activeGames.set(ROOM, { roomId: ROOM, gameState, playerMap: {} } as unknown as OnlineGameState);
  t.after(() => {
    clearRoomTimers(ROOM);
    activeGames.delete(ROOM);
  });

  const { rt } = recordingRuntime();
  await rt.stopTables();

  armTurn(rt, ROOM);
  assert.equal(pending("bot", ROOM), false, "a late armTurn put a bot back on a stopped table");
  for (const kind of TIMER_KINDS) {
    arm(kind, ROOM, 60_000, () => {});
    assert.equal(pending(kind, ROOM), false, `a ${kind} timer was armed after the tables stopped`);
  }
});
