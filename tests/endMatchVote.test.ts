// #850 clause 8: once a seat has been vacated, any remaining player may call a
// unanimous, penalty-free vote to end the match. Reuses the rematch gate's
// own unanimity/abstention shape (`votesUnanimous`, the same formula
// `rematchAnswered` uses) rather than a second vote mechanism — the seats a
// vote counts against is `Object.keys(playerMap).length`, so a bot or a
// vacated seat (neither ever in playerMap) abstains by construction.
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import type { Server as SocketServer } from "socket.io";
import { installTableHandlers, applyOrForward } from "../server/tableHandlers.ts";
import { activeGames } from "../server/gameRoom.ts";
import { clearRoomTimers } from "../server/gameTimers.ts";
import { GameEndMatchVoteSchema } from "../server/socketSchemas.ts";
import type { OnlineGameState } from "../server/gameRoom.ts";
import type { GameOverPayload } from "../lib/matchState.ts";
import type { GameState, Player } from "../lib/gameEngine.ts";

const ROOM = "end-match-vote-room";

function player(id: string, name: string, type: Player["type"] = "human"): Player {
  return { id, name, hand: [], type };
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
    handsPlayed: 2,
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

function midHandOneVacated(): GameState {
  return {
    players: [
      player("p0", "Alice"),
      player("p1", "Drita", "ai"), // vacated
      player("p2", "Carl"),
      player("p3", "Dee"),
    ],
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

function stubIo() {
  const emitted: { event: string; payload: unknown }[] = [];
  const target = {
    emit: (event: string, payload: unknown) => emitted.push({ event, payload }),
    timeout: () => ({ emit: (event: string, payload: unknown) => emitted.push({ event, payload }) }),
  };
  const io = { to: () => target, on: () => {} } as unknown as SocketServer;
  return { io, emitted };
}

before(() => {
  installTableHandlers({ on: () => {} } as unknown as SocketServer);
});

function vote(io: SocketServer, userId: string, wants = true) {
  return applyOrForward(io, {
    kind: "endMatchVote",
    roomId: ROOM,
    userId,
    username: userId,
    wants,
  });
}

describe("the end-match vote, offered only after a vacancy, decided by unanimity (#850 clause 8)", () => {
  test("no vacancy yet: the vote is refused outright", async () => {
    const { io } = stubIo();
    const game = baseGame({
      gameState: {
        players: [player("p0", "Alice"), player("p1", "Bob")],
        currentTurnIndex: 0,
        lastPlayedCombination: null,
        lastPlayedBy: -1,
        passCount: 0,
        gameMode: "free_for_all",
        roundWinner: null,
        gameOver: false,
        rankings: [],
        firstPlayMade: true,
      },
      playerMap: { 0: "alice", 1: "bob" },
    });
    activeGames.set(ROOM, game);

    try {
      const outcome = await vote(io, "alice");
      assert.deepEqual(outcome, { ok: false, code: "NO_VACANCY_TO_END" });
    } finally {
      activeGames.delete(ROOM);
    }
  });

  test("a seatless caller cannot vote", async () => {
    const { io } = stubIo();
    const game = baseGame({
      gameState: midHandOneVacated(),
      playerMap: { 0: "alice", 2: "carl", 3: "dee" },
      vacatedSeats: new Map([[1, { userId: "drita", username: "Drita" }]]),
    });
    activeGames.set(ROOM, game);

    try {
      const outcome = await vote(io, "ghost");
      assert.deepEqual(outcome, { ok: false, code: "NOT_SEATED" });
    } finally {
      activeGames.delete(ROOM);
    }
  });

  test("counts against the three seated humans, not the four seats at the table", async () => {
    const { io, emitted } = stubIo();
    const game = baseGame({
      gameState: midHandOneVacated(),
      playerMap: { 0: "alice", 2: "carl", 3: "dee" },
      vacatedSeats: new Map([[1, { userId: "drita", username: "Drita" }]]),
    });
    activeGames.set(ROOM, game);

    try {
      await vote(io, "alice");
      await vote(io, "carl");
      // Two of three: not unanimous yet, and the vacated seat contributes
      // nothing to either side of the count.
      assert.equal(game.matchOver, false);
      assert.ok(!emitted.some((e) => e.event === "game:over"));

      await vote(io, "dee");
      // The third and last seated human closes it — 3 of 3, not 3 of 4.
      assert.equal(game.matchOver, true);

      const over = emitted.find((e) => e.event === "game:over")?.payload as
        | GameOverPayload
        | undefined;
      assert.ok(over, "unanimity ends the match");
      assert.equal(over!.voided, false, "an agreed end is not the same as an abandoned one");
      assert.deepEqual(over!.rankings, []);
      assert.equal(over!.recorded, false);

      assert.ok(
        emitted.some(
          (e) =>
            e.event === "game:notification" &&
            (e.payload as { code: string }).code === "MATCH_ENDED_BY_AGREEMENT"
        ),
        "the table is told the match ended by agreement"
      );
    } finally {
      clearRoomTimers(ROOM);
      activeGames.delete(ROOM);
    }
  });

  test("a repeat vote from the same seat does not double-count toward unanimity", async () => {
    const { io, emitted } = stubIo();
    const game = baseGame({
      gameState: midHandOneVacated(),
      playerMap: { 0: "alice", 2: "carl", 3: "dee" },
      vacatedSeats: new Map([[1, { userId: "drita", username: "Drita" }]]),
    });
    activeGames.set(ROOM, game);

    try {
      await vote(io, "alice");
      await vote(io, "alice");
      await vote(io, "alice");
      assert.equal(game.matchOver, false);
      assert.ok(!emitted.some((e) => e.event === "game:over"));
    } finally {
      activeGames.delete(ROOM);
    }
  });

  test("withdrawing a vote leaves the tally empty and cannot end the match", async () => {
    const { io, emitted } = stubIo();
    const game = baseGame({
      gameState: midHandOneVacated(),
      playerMap: { 0: "alice", 2: "carl", 3: "dee" },
      vacatedSeats: new Map([[1, { userId: "drita", username: "Drita" }]]),
    });
    activeGames.set(ROOM, game);

    try {
      await vote(io, "alice");
      await vote(io, "alice", false);
      assert.equal(game.endMatchVotes.size, 0);
      assert.equal(game.matchOver, false);
      assert.ok(!emitted.some((e) => e.event === "game:over"));
    } finally {
      activeGames.delete(ROOM);
    }
  });

  test("withdrawing a vote from a seat that never voted is a no-op", async () => {
    const { io } = stubIo();
    const game = baseGame({
      gameState: midHandOneVacated(),
      playerMap: { 0: "alice", 2: "carl", 3: "dee" },
      vacatedSeats: new Map([[1, { userId: "drita", username: "Drita" }]]),
    });
    activeGames.set(ROOM, game);

    try {
      const outcome = await vote(io, "alice", false);
      assert.equal(outcome.ok, true);
      assert.equal(game.endMatchVotes.size, 0);
    } finally {
      activeGames.delete(ROOM);
    }
  });
});

describe("GameEndMatchVoteSchema — an old client's absent payload must still vote yes", () => {
  test("no payload at all defaults to wants: true", () => {
    assert.deepEqual(GameEndMatchVoteSchema.parse(undefined), { wants: true });
    assert.deepEqual(GameEndMatchVoteSchema.parse(null), { wants: true });
    assert.deepEqual(GameEndMatchVoteSchema.parse({}), { wants: true });
  });

  test("an explicit wants is respected either way", () => {
    assert.deepEqual(GameEndMatchVoteSchema.parse({ wants: false }), { wants: false });
    assert.deepEqual(GameEndMatchVoteSchema.parse({ wants: true }), { wants: true });
  });
});
