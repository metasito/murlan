// #850 clause 6: a match abandoned before a single point is scored is voided
// for every seat — nothing earned, nothing taken, rated for nobody. This is
// gated on `game.handsPlayed === 0`, not on the walkout alone, so a table that
// genuinely finished its first hand and then loses its last human is scored
// normally rather than wiped.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { Server as SocketServer } from "socket.io";
import { vacateSeat } from "../server/gameTurn.ts";
import { activeGames } from "../server/gameRoom.ts";
import { clearRoomTimers } from "../server/gameTimers.ts";
import type { OnlineGameState } from "../server/gameRoom.ts";
import type { GameOverPayload } from "../lib/matchState.ts";
import type { GameState, Player } from "../lib/gameEngine.ts";

const ROOM = "void-abandoned-room";

function player(id: string, name: string, hand: Player["hand"] = []): Player {
  return { id, name, hand, type: "human" };
}

function baseGame(overrides: Partial<OnlineGameState>): OnlineGameState {
  return {
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
    handsPlayed: 0,
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
    ...overrides,
  } as OnlineGameState;
}

function stubIo() {
  const emitted: { event: string; payload: unknown }[] = [];
  const io = {
    to: () => ({
      emit: (event: string, payload: unknown) => emitted.push({ event, payload }),
      timeout: () => ({ emit: (event: string, payload: unknown) => emitted.push({ event, payload }) }),
    }),
  } as unknown as SocketServer;
  return { io, emitted };
}

function midHandTwoSeats(): GameState {
  return {
    players: [player("p0", "Alice", [{ rank: "4", suit: "spades" } as never]), player("p1", "Bob", [])],
    currentTurnIndex: 0,
    lastPlayedCombination: null,
    lastPlayedBy: -1,
    passCount: 0,
    gameMode: "free_for_all",
    roundWinner: null,
    gameOver: false,
    rankings: [],
    firstPlayMade: true,
  };
}

describe("a match abandoned with no hand yet decided is voided, not scored (#850 clause 6)", () => {
  test("the sole remaining seat leaving a still-0-hands match voids it: no rankings, no winners", async () => {
    const { io, emitted } = stubIo();
    const game = baseGame({
      gameState: midHandTwoSeats(),
      playerMap: { 0: "alice", 1: "bob" },
      handsPlayed: 0,
    });
    activeGames.set(ROOM, game);

    try {
      await vacateSeat(io, ROOM, "bob", "Bob");

      const over = emitted.find((e) => e.event === "game:over")?.payload as
        | GameOverPayload
        | undefined;
      assert.ok(over, "a voided match still tells the table it is over");
      assert.equal(over!.voided, true);
      assert.deepEqual(over!.rankings, []);
      assert.deepEqual(over!.scores, []);
      assert.equal(over!.recorded, false);
      // The table is gone — void is terminal, not "waiting on a rematch vote".
      assert.equal(activeGames.has(ROOM), false);
    } finally {
      clearRoomTimers(ROOM);
      activeGames.delete(ROOM);
    }
  });

  test("the same walkout after a hand has been decided is scored normally, not voided", async () => {
    const { io, emitted } = stubIo();
    const game = baseGame({
      gameState: midHandTwoSeats(),
      playerMap: { 0: "alice", 1: "bob" },
      handsPlayed: 1, // one manche already resolved for real
      cumulativeScores: { alice: 3, bob: 1 },
    });
    activeGames.set(ROOM, game);

    try {
      await vacateSeat(io, ROOM, "bob", "Bob");

      const over = emitted.find((e) => e.event === "game:over")?.payload as
        | GameOverPayload
        | undefined;
      assert.ok(over, "the concede-and-score path still ends the match");
      assert.equal(over!.voided, false, "a hand was genuinely played — nothing here is voided");
    } finally {
      clearRoomTimers(ROOM);
      activeGames.delete(ROOM);
    }
  });
});
