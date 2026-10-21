// #850 clause 6: a match abandoned before a single point is scored is voided
// for every seat — nothing earned, nothing taken, rated for nobody. This is
// gated on `game.roundsPlayed === 0`, not on the walkout alone, so a table that
// genuinely finished its first round and then loses its last human is scored
// normally rather than wiped.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { recordingRuntime } from "../helpers/recordingRuntime.ts";
import { vacateSeat } from "../../server/game/gameTurn.ts";
import { activeGames } from "../../server/game/gameRoom.ts";
import { clearRoomTimers } from "../../server/game/gameTimers.ts";
import type { OnlineGameState } from "../../server/game/gameRoom.ts";
import { onlineTable } from "../helpers/onlineTable.ts";
import { roundOverSchema } from "../../shared/protocol.ts";
import type { GameState, Player } from "../../lib/game/gameEngine.ts";
import { aThreePlayed } from "../support/game.ts";

const ROOM = "void-abandoned-room";

function player(id: string, name: string, hand: Player["hand"] = []): Player {
  return { id, name, hand, type: "human" };
}

function baseGame(overrides: Partial<OnlineGameState>): OnlineGameState {
  return onlineTable({ roomId: ROOM, ...overrides });
}

function midRoundTwoSeats(): GameState {
  return {
    players: [player("p0", "Alice", [{ rank: "4", suit: "spades" } as never]), player("p1", "Bob", [])],
    currentTurnIndex: 0,
    lastPlayedCombination: null,
    lastPlayedBy: -1,
    passCount: 0,
    gameMode: "free_for_all",
    trickWinner: null,
    roundOver: false,
    finishingOrder: [],
    firstPlayMade: true,
    playedRanks: aThreePlayed(),
    lastMove: { seq: 0, kind: "deal" },
  };
}

describe("a match abandoned with no round yet decided is voided, not scored (#850 clause 6)", () => {
  test("the sole remaining seat leaving a still-0-round match voids it: no finishingOrder, no winners", async () => {
    const { rt, events } = recordingRuntime();
    const game = baseGame({
      gameState: midRoundTwoSeats(),
      playerMap: { 0: "alice", 1: "bob" },
      roundsPlayed: 0,
    });
    activeGames.set(ROOM, game);

    try {
      await vacateSeat(rt, ROOM, "bob");

      assert.ok(events("game:round_over")[0], "a voided match still tells the table it is over");
      const over = roundOverSchema.parse(events("game:round_over")[0]);
      assert.equal(over.voided, true);
      assert.deepEqual(over.finishingOrder, []);
      assert.deepEqual(over.scores, []);
      assert.equal(over.recorded, false);
      // The table is gone — void is terminal, not "waiting on a rematch vote".
      assert.equal(activeGames.has(ROOM), false);
    } finally {
      clearRoomTimers(ROOM);
      activeGames.delete(ROOM);
    }
  });

  test("the same walkout after a round has been decided is scored normally, not voided", async () => {
    const { rt, events } = recordingRuntime();
    const game = baseGame({
      gameState: midRoundTwoSeats(),
      playerMap: { 0: "alice", 1: "bob" },
      roundsPlayed: 1, // one round already resolved for real
      cumulativeScores: { alice: 3, bob: 1 },
    });
    activeGames.set(ROOM, game);

    try {
      await vacateSeat(rt, ROOM, "bob");

      assert.ok(events("game:round_over")[0], "the concede-and-score path still ends the match");
      const over = roundOverSchema.parse(events("game:round_over")[0]);
      assert.equal(over.voided, false, "a round was genuinely played — nothing here is voided");
    } finally {
      clearRoomTimers(ROOM);
      activeGames.delete(ROOM);
    }
  });
});
