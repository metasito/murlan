// #850 clause 8: once a seat has been vacated, any remaining player may call a
// unanimous, penalty-free vote to end the match. Reuses the rematch gate's
// own unanimity/abstention shape (`votesUnanimous`, the same formula
// `rematchAnswered` uses) rather than a second vote mechanism — the seats a
// vote counts against is `Object.keys(playerMap).length`, so a bot or a
// vacated seat (neither ever in playerMap) abstains by construction.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { recordingRuntime } from "../helpers/recordingRuntime.ts";
import type { TableRuntime } from "../../server/game/tableRuntime.ts";
import { rehydrateGame } from "../../server/game/tableLifecycle.ts";
import { applyOrForward } from "../../server/game/tableRouter.ts";
import { activeGames } from "../../server/game/gameRoom.ts";
import { useMemoryTableStores } from "../helpers/memoryTableStores.ts";
import { clearRoomTimers } from "../../server/game/gameTimers.ts";
import { GameEndMatchVoteSchema } from "../../shared/socketSchemas.ts";
import type { OnlineGameState } from "../../server/game/gameRoom.ts";
import { onlineTable } from "../helpers/onlineTable.ts";
import type { RoundOverPayload } from "../../shared/protocol.ts";
import type { GameState, Player } from "../../lib/game/gameEngine.ts";
import { refuse } from "../../server/shared/refusal.ts";
import { emptyRankTally } from "../../lib/game/gameEngine.ts";

const ROOM = "end-match-vote-room";

function player(id: string, name: string, type: Player["type"] = "human"): Player {
  return { id, name, hand: [], type };
}

function baseGame(overrides: Partial<OnlineGameState>): OnlineGameState {
  return onlineTable({ roomId: ROOM, roundsPlayed: 2, ...overrides });
}

function midRoundOneVacated(): GameState {
  return {
    players: [
      player("p0", "Alice"),
      player("p1", "Drita", "bot"), // vacated
      player("p2", "Carl"),
      player("p3", "Dee"),
    ],
    currentTurnIndex: 0,
    lastPlayedCombination: null,
    lastPlayedBy: -1,
    passCount: 0,
    gameMode: "free_for_all",
    trickWinner: null,
    roundOver: false,
    finishingOrder: [],
    firstPlayMade: true,
    playedRanks: emptyRankTally(),
    lastMove: { seq: 0, kind: "deal" },
  };
}

function stubIo() {
  const { rt, sent } = recordingRuntime();
  return { rt, emitted: sent };
}

function vote(rt: TableRuntime, userId: string, wants = true) {
  return applyOrForward(rt, {
    kind: "endMatchVote",
    roomId: ROOM,
    userId,
    wants,
  });
}

describe("the end-match vote, offered only after a vacancy, decided by unanimity (#850 clause 8)", () => {
  test("no vacancy yet: the vote is refused outright", async () => {
    const { rt } = stubIo();
    const game = baseGame({
      gameState: {
        players: [player("p0", "Alice"), player("p1", "Bob")],
        currentTurnIndex: 0,
        lastPlayedCombination: null,
        lastPlayedBy: -1,
        passCount: 0,
        gameMode: "free_for_all",
        trickWinner: null,
        roundOver: false,
        finishingOrder: [],
        firstPlayMade: true,
        playedRanks: emptyRankTally(),
        lastMove: { seq: 0, kind: "deal" },
      },
      playerMap: { 0: "alice", 1: "bob" },
    });
    activeGames.set(ROOM, game);

    try {
      const outcome = await vote(rt, "alice");
      assert.deepEqual(outcome, { ok: false, code: "NO_VACANCY_TO_END" });
    } finally {
      activeGames.delete(ROOM);
    }
  });

  test("a seatless caller cannot vote", async () => {
    const { rt } = stubIo();
    const game = baseGame({
      gameState: midRoundOneVacated(),
      playerMap: { 0: "alice", 2: "carl", 3: "dee" },
      vacatedSeats: new Map([[1, { userId: "drita", username: "Drita" }]]),
    });
    activeGames.set(ROOM, game);

    try {
      const outcome = await vote(rt, "ghost");
      assert.deepEqual(outcome, { ok: false, code: "NOT_SEATED" });
    } finally {
      activeGames.delete(ROOM);
    }
  });

  test("counts against the three seated humans, not the four seats at the table", async () => {
    const { rt, emitted } = stubIo();
    const game = baseGame({
      gameState: midRoundOneVacated(),
      playerMap: { 0: "alice", 2: "carl", 3: "dee" },
      vacatedSeats: new Map([[1, { userId: "drita", username: "Drita" }]]),
    });
    activeGames.set(ROOM, game);

    try {
      await vote(rt, "alice");
      await vote(rt, "carl");
      // Two of three: not unanimous yet, and the vacated seat contributes
      // nothing to either side of the count.
      assert.equal(game.matchOver, false);
      assert.ok(!emitted.some((e) => e.event === "game:round_over"));

      await vote(rt, "dee");
      // The third and last seated human closes it — 3 of 3, not 3 of 4.
      assert.equal(game.matchOver, true);

      const over = emitted.find((e) => e.event === "game:round_over")?.payload as
        | RoundOverPayload
        | undefined;
      assert.ok(over, "unanimity ends the match");
      assert.equal(over!.voided, false, "an agreed end is not the same as an abandoned one");
      assert.deepEqual(over!.finishingOrder, []);
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
    const { rt, emitted } = stubIo();
    const game = baseGame({
      gameState: midRoundOneVacated(),
      playerMap: { 0: "alice", 2: "carl", 3: "dee" },
      vacatedSeats: new Map([[1, { userId: "drita", username: "Drita" }]]),
    });
    activeGames.set(ROOM, game);

    try {
      await vote(rt, "alice");
      await vote(rt, "alice");
      await vote(rt, "alice");
      assert.equal(game.matchOver, false);
      assert.ok(!emitted.some((e) => e.event === "game:round_over"));
    } finally {
      activeGames.delete(ROOM);
    }
  });

  test("withdrawing a vote leaves the tally empty and cannot end the match", async () => {
    const { rt, emitted } = stubIo();
    const game = baseGame({
      gameState: midRoundOneVacated(),
      playerMap: { 0: "alice", 2: "carl", 3: "dee" },
      vacatedSeats: new Map([[1, { userId: "drita", username: "Drita" }]]),
    });
    activeGames.set(ROOM, game);

    try {
      await vote(rt, "alice");
      await vote(rt, "alice", false);
      assert.equal(game.endMatchVotes.size, 0);
      assert.equal(game.matchOver, false);
      assert.ok(!emitted.some((e) => e.event === "game:round_over"));
    } finally {
      activeGames.delete(ROOM);
    }
  });

  test("withdrawing a vote from a seat that never voted is a no-op", async () => {
    const { rt } = stubIo();
    const game = baseGame({
      gameState: midRoundOneVacated(),
      playerMap: { 0: "alice", 2: "carl", 3: "dee" },
      vacatedSeats: new Map([[1, { userId: "drita", username: "Drita" }]]),
    });
    activeGames.set(ROOM, game);

    try {
      const outcome = await vote(rt, "alice", false);
      assert.equal(outcome.ok, true);
      assert.equal(game.endMatchVotes.size, 0);
    } finally {
      activeGames.delete(ROOM);
    }
  });
});

describe("a match ended by the vote is never rematched (docs/GAME-RULES.md § Decisions)", () => {
  function partlyRanked(): GameState {
    const state = midRoundOneVacated();
    // Two of the four seats finished before the table agreed to stop.
    return { ...state, finishingOrder: ["p0", "p2"] };
  }

  async function endByVote(game: OnlineGameState, rt: TableRuntime) {
    activeGames.set(ROOM, game);
    await vote(rt, "alice");
    await vote(rt, "carl");
    await vote(rt, "dee");
  }

  const vacated = new Map([[1, { userId: "drita", username: "Drita" }]]);

  test("the rematch vote is refused, so no deal reads the partial finishingOrder", async () => {
    const { rt } = stubIo();
    const game = baseGame({
      gameState: partlyRanked(),
      playerMap: { 0: "alice", 2: "carl", 3: "dee" },
      vacatedSeats: vacated,
    });

    try {
      await endByVote(game, rt);
      assert.equal(game.endedByVote, true);

      const outcome = await applyOrForward(rt, {
        kind: "rematchVote",
        roomId: ROOM,
        userId: "alice",
      });
      assert.deepEqual(outcome, refuse("REMATCH_DECLINED"));
      assert.equal(game.gameState.exchangePhase, undefined, "nothing was dealt");
      assert.deepEqual(game.gameState.finishingOrder, ["p0", "p2"]);
    } finally {
      clearRoomTimers(ROOM);
      activeGames.delete(ROOM);
    }
  });

  test("a restart does not reopen the rematch", async (t) => {
    const { rt } = recordingRuntime({ persist: "real" });
    useMemoryTableStores(t);
    const game = baseGame({
      gameState: partlyRanked(),
      playerMap: { 0: "alice", 2: "carl", 3: "dee" },
      vacatedSeats: vacated,
    });

    try {
      await endByVote(game, rt);
      await new Promise((r) => setTimeout(r, 20));
      activeGames.delete(ROOM);

      assert.equal(await rehydrateGame(rt, ROOM, "alice"), "restored");
      const outcome = await applyOrForward(rt, {
        kind: "rematchVote",
        roomId: ROOM,
        userId: "alice",
      });
      assert.deepEqual(outcome, refuse("REMATCH_DECLINED"));
    } finally {
      clearRoomTimers(ROOM);
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
