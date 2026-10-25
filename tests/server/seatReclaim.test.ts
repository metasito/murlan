// #850 clause 7: the seat is reclaimable by the same account for the life of
// the match. Routed through the real `applyOrForward` -> `applyTableAction`
// -> `rejoinAction` path, rather than calling a private function directly, so the DoD's own
// four things — the rejoin path, both announcements, and the AFK-rearm guard
// — are each proved against the actual wiring, not a stand-in for it.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { recordingRuntime } from "../helpers/recordingRuntime.ts";
import { applyOrForward } from "../../server/game/tableRouter.ts";
import { armTurn } from "../../server/game/gameTurn.ts";
import { activeGames } from "../../server/game/gameRoom.ts";
import { clearRoomTimers } from "../../server/game/gameTimers.ts";
import { resolveRoundEnd } from "../../server/game/onlineGameLogic.ts";
import { scoresByEngineId } from "../../server/game/roundOver.ts";
import { applyRoundFold } from "../../server/game/matchLedger.ts";
import type { OnlineGameState } from "../../server/game/gameRoom.ts";
import { onlineTable } from "../helpers/onlineTable.ts";
import type { GameState, Player } from "../../lib/game/gameEngine.ts";
import { aThreePlayed } from "../support/game.ts";

const ROOM = "seat-reclaim-room";

function player(id: string, name: string, type: Player["type"] = "human"): Player {
  return { id, name, hand: [], type };
}

function baseGame(overrides: Partial<OnlineGameState>): OnlineGameState {
  return onlineTable({ roomId: ROOM, roundsPlayed: 1, ...overrides });
}

function midRound(): GameState {
  return {
    players: [
      player("p0", "Alice"),
      player("p1", "Drita", "bot"),
      player("p2", "Carl"),
      player("p3", "Dee"),
    ],
    currentTurnIndex: 0, // Alice's turn, not the vacated seat's — no bot timer fires.
    lastPlayedCombination: null,
    lastPlayedBy: -1,
    passCount: 0,
    gameMode: "free_for_all",
    roundOver: false,
    finishingOrder: [],
    openingCard: null,
    playedRanks: aThreePlayed(),
    lastMove: { seq: 1, kind: "pass", seat: 3, closedTrick: true },
  };
}

function stubIo() {
  const { rt, sent } = recordingRuntime();
  return { rt, emitted: sent };
}

describe("a vacated seat is reclaimable by the account that left it (#850 clause 7)", () => {
  test("reclaim restores the seat, and both the departure and the return are announced", async () => {
    const { rt, emitted } = stubIo();
    const game = baseGame({
      gameState: midRound(),
      playerMap: { 0: "alice", 2: "carl", 3: "dee" }, // seat 1 already vacated
      vacatedSeats: new Map([[1, { userId: "drita", username: "Drita" }]]),
      releasedSeats: new Set(["drita"]),
    });
    activeGames.set(ROOM, game);

    try {
      const outcome = await applyOrForward(rt, {
        kind: "rejoin",
        roomId: ROOM,
        userId: "drita",
      });

      assert.equal(outcome.ok, true);
      assert.equal(game.playerMap[1], "drita", "the seat must read as drita's again");
      assert.ok(!game.vacatedSeats.has(1));
      assert.ok(!game.releasedSeats.has("drita"), "reclaiming un-releases the account");
      assert.equal(game.gameState.players[1]!.type, "human");

      const reconnected = emitted.find((e) => e.event === "game:player_reconnected");
      assert.ok(reconnected, "the return must be announced");
      assert.equal((reconnected!.payload as { seatIndex: number }).seatIndex, 1);
    } finally {
      clearRoomTimers(ROOM);
      activeGames.delete(ROOM);
    }
  });

  test("SEAT_RELEASED still answers once the seat itself is not reclaimable", async () => {
    const { rt } = stubIo();
    const game = baseGame({
      gameState: midRound(),
      playerMap: { 0: "alice", 2: "carl", 3: "dee" },
      vacatedSeats: new Map(), // nothing of drita's left open to reclaim
      releasedSeats: new Set(["drita"]),
    });
    activeGames.set(ROOM, game);

    try {
      const outcome = await applyOrForward(rt, {
        kind: "rejoin",
        roomId: ROOM,
        userId: "drita",
      });
      assert.deepEqual(outcome, { ok: false, code: "SEAT_RELEASED" });
    } finally {
      activeGames.delete(ROOM);
    }
  });

  test("a stranger who never sat here is unauthorized, not seat-released", async () => {
    const { rt } = stubIo();
    const game = baseGame({
      gameState: midRound(),
      playerMap: { 0: "alice", 2: "carl", 3: "dee" },
    });
    activeGames.set(ROOM, game);

    try {
      const outcome = await applyOrForward(rt, {
        kind: "rejoin",
        roomId: ROOM,
        userId: "ghost",
      });
      assert.deepEqual(outcome, { ok: false, code: "UNAUTHORIZED" });
    } finally {
      activeGames.delete(ROOM);
    }
  });

  test("a reclaim ahead of a pending bot timer re-arms instead of playing the reclaimed seat's turn", async () => {
    const { rt } = stubIo();
    const state = midRound();
    state.currentTurnIndex = 1; // the vacated seat's own turn is up next
    const game = baseGame({
      gameState: state,
      playerMap: { 0: "alice", 2: "carl", 3: "dee" }, // seat 1 vacant
      vacatedSeats: new Map([[1, { userId: "drita", username: "Drita" }]]),
      releasedSeats: new Set(["drita"]),
    });
    activeGames.set(ROOM, game);
    // A short delay stands in for the real 1.2 s default.
    process.env.MURLAN_BOT_MOVE_DELAY_MS = "5";

    try {
      armTurn(rt, ROOM);
      assert.ok(!game.turnDeadlineMs, "a vacant acting seat carries no human AFK clock yet");

      // The reclaim lands while that timer is still pending.
      await applyOrForward(rt, {
        kind: "rejoin",
        roomId: ROOM,
        userId: "drita",
      });

      await new Promise((r) => setTimeout(r, 40));

      // The guard (server/game/gameTurn.ts's runBotTurn) sees the seat reclaimed
      // and re-arms rather than playing on drita's behalf — her hand is
      // untouched and the seat now carries a human AFK clock instead. Read
      // off `game.gameState`, not the local `state`: a real play would have
      // replaced it with a new object, leaving `state` stale.
      assert.equal(
        game.gameState.currentTurnIndex,
        1,
        "nothing played the reclaimed seat's turn for it"
      );
      assert.equal(typeof game.turnDeadlineMs, "number", "the seat now carries its own AFK clock");
    } finally {
      delete process.env.MURLAN_BOT_MOVE_DELAY_MS;
      clearRoomTimers(ROOM);
      activeGames.delete(ROOM);
    }
  });
});

function finishedRound(finishingOrder: string[]): GameState {
  return {
    players: [
      player("p0", "Alice"),
      player("p1", "Drita", "bot"),
      player("p2", "Carl"),
      player("p3", "Dee"),
    ],
    currentTurnIndex: 0,
    lastPlayedCombination: null,
    lastPlayedBy: -1,
    passCount: 0,
    gameMode: "free_for_all",
    roundOver: true,
    finishingOrder,
    openingCard: null,
    playedRanks: aThreePlayed(),
    lastMove: { seq: 0, kind: "deal" },
  };
}

describe("a reclaim merges the vacated seat's carried points into the returning player's own key (#894)", () => {
  test("cumulativeScores, both readers, and endMatchVotes all agree after the reclaim", async () => {
    const { rt, emitted } = stubIo();
    const game = baseGame({
      gameState: midRound(),
      playerMap: { 0: "alice", 2: "carl", 3: "dee" }, // seat 1 vacated
      vacatedSeats: new Map([[1, { userId: "drita", username: "Drita" }]]),
      releasedSeats: new Set(["drita"]),
      cumulativeScores: { alice: 2, drita: 8, carl: 1, dee: 1 },
      roundsPlayed: 2,
      endMatchVotes: new Set(["alice", "carl"]),
    });
    activeGames.set(ROOM, game);

    try {
      // Fold one round while the seat is still vacated — the bot seat (seat 1)
      // finishes first and scores under "bot:1", not under "drita".
      const result = resolveRoundEnd({
        state: finishedRound(["p1", "p0", "p2", "p3"]),
        playerMap: game.playerMap,
        cumulativeScores: game.cumulativeScores,
        matchTarget: 21,
        matchLength: "match",
        gameMode: "free_for_all",
        roundFlags: {},
        abandonedSeats: new Map(),
        vacatedSeats: game.vacatedSeats,
      });
      applyRoundFold(game, result);

      assert.ok(
        (game.cumulativeScores["bot:1"] ?? 0) > 0,
        "the vacated seat must actually have scored, or the rest of this test proves nothing"
      );
      assert.equal(game.cumulativeScores["bot:1"], 3);

      const outcome = await applyOrForward(rt, {
        kind: "rejoin",
        roomId: ROOM,
        userId: "drita",
      });
      assert.equal(outcome.ok, true);

      assert.equal(game.cumulativeScores["bot:1"], undefined, "the orphaned bucket must be gone");
      assert.equal(game.cumulativeScores.drita, 11, "the frozen total plus the bot's carried points");
      assert.equal(
        scoresByEngineId(game)["p1"],
        11,
        "the live-standings reader must agree with the ledger"
      );
      const sum = Object.values(game.cumulativeScores).reduce((a, b) => a + b, 0);
      assert.equal(
        sum,
        6 * game.roundsPlayed,
        "the standings must sum to the rounds played, asserted as arithmetic"
      );
      assert.equal(game.endMatchVotes.size, 0, "a roster change makes the vote new again");
      const voteState = emitted.filter((e) => e.event === "game:end_match_vote_state").pop();
      assert.ok(voteState, "the cleared tally must be broadcast, not just held in server memory");
      assert.deepEqual(
        (voteState!.payload as { votes: string[] }).votes,
        [],
        "a client still showing alice+carl's old vote would need this to know it is gone"
      );
    } finally {
      clearRoomTimers(ROOM);
      activeGames.delete(ROOM);
    }
  });

  test("the carried points can be the difference in crossing the match target (finding 2: applyRoundFold)", async () => {
    const { rt } = stubIo();
    const game = baseGame({
      gameState: midRound(),
      playerMap: { 0: "alice", 2: "carl", 3: "dee" }, // seat 1 vacated
      vacatedSeats: new Map([[1, { userId: "drita", username: "Drita" }]]),
      releasedSeats: new Set(["drita"]),
      cumulativeScores: { alice: 2, drita: 8, carl: 1, dee: 1 },
      matchTarget: 12,
      roundsPlayed: 1,
    });
    activeGames.set(ROOM, game);

    try {
      // Round 1, still vacated: the bot seat (seat 1) finishes first and
      // carries 3 points under "bot:1" — cumulativeScores.drita stays frozen
      // at 8, below the 12 target either way.
      const first = resolveRoundEnd({
        state: finishedRound(["p1", "p0", "p2", "p3"]),
        playerMap: game.playerMap,
        cumulativeScores: game.cumulativeScores,
        matchTarget: game.matchTarget,
        matchLength: "match",
        gameMode: "free_for_all",
        roundFlags: {},
        abandonedSeats: new Map(),
        vacatedSeats: game.vacatedSeats,
      });
      applyRoundFold(game, first);
      assert.equal(first.matchOver, false, "8 and 3 apart do not yet reach 12 either way");

      await applyOrForward(rt, { kind: "rejoin", roomId: ROOM, userId: "drita" });
      assert.equal(game.cumulativeScores.drita, 11, "the reclaim already merged the carried 3 points");

      // Round 2, seat 1 now drita's own again: she finishes first a second
      // time. 11 (merged) + 3 = 14, over the 12 target — the match must end
      // and name her the winner. A reader that resolved the target from the
      // orphaned "bot:1" bucket instead of the merged "drita" key would see
      // only 8 + 3 = 11 here and wrongly call the match still running.
      const second = resolveRoundEnd({
        state: finishedRound(["p1", "p0", "p2", "p3"]),
        playerMap: game.playerMap,
        cumulativeScores: game.cumulativeScores,
        matchTarget: game.matchTarget,
        matchLength: "match",
        gameMode: "free_for_all",
        roundFlags: {},
        abandonedSeats: new Map(),
        vacatedSeats: game.vacatedSeats,
      });

      assert.equal(second.cumulativeScores.drita, 14);
      assert.equal(second.matchOver, true, "the match must end the instant the merged total crosses target");
      assert.deepEqual(second.matchWinners, ["drita"]);
    } finally {
      clearRoomTimers(ROOM);
      activeGames.delete(ROOM);
    }
  });

  test("scoresByEngineId already merges a still-vacated seat's frozen total with the bot's (finding 1)", () => {
    const game = baseGame({
      gameState: midRound(),
      playerMap: { 0: "alice", 2: "carl", 3: "dee" }, // seat 1 vacated
      vacatedSeats: new Map([[1, { userId: "drita", username: "Drita" }]]),
      releasedSeats: new Set(["drita"]),
      cumulativeScores: { alice: 2, drita: 8, carl: 1, dee: 1 },
      roundsPlayed: 2,
    });

    const result = resolveRoundEnd({
      state: finishedRound(["p1", "p0", "p2", "p3"]),
      playerMap: game.playerMap,
      cumulativeScores: game.cumulativeScores,
      matchTarget: 21,
      matchLength: "match",
      gameMode: "free_for_all",
      roundFlags: {},
      abandonedSeats: new Map(),
      vacatedSeats: game.vacatedSeats,
    });
    Object.assign(game, { cumulativeScores: result.cumulativeScores });

    assert.equal(
      scoresByEngineId(game)["p1"],
      game.cumulativeScores.drita + game.cumulativeScores["bot:1"]!,
      "the live-standings row for a still-vacated seat must show the frozen total plus the bot's, not just the bot's"
    );
  });
});
