import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  vacate,
  reclaim,
  clearForDeal,
  castEndMatchVote,
} from "../../server/game/seatLedger.ts";
import { seatTotal } from "../../server/game/onlineGameLogic.ts";
import type { OnlineGameState } from "../../server/game/gameRoom.ts";
import { onlineTable } from "../helpers/onlineTable.ts";
import type { GameState, Player } from "../../lib/game/gameEngine.ts";

function player(id: string, name: string, type: Player["type"] = "human"): Player {
  return { id, name, hand: [], type };
}

function table(overrides: Partial<OnlineGameState> = {}): OnlineGameState {
  const gameState: GameState = {
    players: [player("p0", "Alice"), player("p1", "Drita"), player("p2", "Carl", "bot")],
    currentTurnIndex: 0,
    lastPlayedCombination: null,
    lastPlayedBy: -1,
    passCount: 0,
    gameMode: "free_for_all",
    trickWinner: null,
    roundOver: false,
    finishingOrder: [],
    firstPlayMade: true,
  };
  return onlineTable({
    roomId: "seat-ledger-room",
    gameState,
    playerMap: { 0: "u-alice", 1: "u-drita" },
    cumulativeScores: { "u-alice": 4, "u-drita": 7, "bot:2": 3 },
    ...overrides,
  });
}

describe("seat ledger", () => {
  test("a mid-hand vacate hands the seat to a weak bot and records the abandonment", () => {
    const game = table();
    castEndMatchVote(game, "u-alice", true);

    assert.deepEqual(vacate(game, 1, { midHand: true }), { abandoned:true });

    assert.equal(game.playerMap[1], undefined);
    assert.equal(game.gameState.players[1].type, "bot");
    assert.ok(game.releasedSeats.has("u-drita"));
    assert.deepEqual(game.vacatedSeats.get(1), { userId: "u-drita", username: "Drita" });
    assert.equal(game.abandonedSeats.get(1), "u-drita");
    assert.ok(game.weakSeats.has(1));
    assert.equal(game.endMatchVotes.size, 0);
  });

  test("a seat vacated between hands, or after it went out, is no abandonment", () => {
    const between = table();
    assert.deepEqual(vacate(between, 1, { midHand: false }), { abandoned:false });
    assert.equal(between.abandonedSeats.size, 0);
    assert.equal(between.weakSeats.size, 0);
    assert.ok(between.vacatedSeats.has(1));

    const finished = table();
    finished.gameState.players[1].finishPosition = 1;
    assert.deepEqual(vacate(finished, 1, { midHand: true }), { abandoned:false });
    assert.equal(finished.abandonedSeats.size, 0);
    assert.equal(finished.weakSeats.size, 0);
  });

  test("vacate then reclaim gives the seat back with the bot's points carried over", () => {
    const game = table();
    vacate(game, 1, { midHand: true });
    // The bot plays on and scores under the seat's bot key.
    game.cumulativeScores["bot:1"] = 5;
    assert.equal(seatTotal(game.cumulativeScores, game.playerMap, game.vacatedSeats, 1), 12);
    castEndMatchVote(game, "u-alice", true);

    assert.equal(reclaim(game, "u-drita"), 1);

    assert.equal(game.playerMap[1], "u-drita");
    assert.equal(game.gameState.players[1].type, "human");
    assert.equal(game.cumulativeScores["u-drita"], 12);
    assert.equal("bot:1" in game.cumulativeScores, false);
    assert.equal(game.cumulativeScores["bot:2"], 3);
    assert.equal(seatTotal(game.cumulativeScores, game.playerMap, game.vacatedSeats, 1), 12);
    assert.equal(game.vacatedSeats.size, 0);
    assert.equal(game.releasedSeats.has("u-drita"), false);
    assert.equal(game.endMatchVotes.size, 0);
  });

  test("reclaim answers null for an account with no vacated seat, touching nothing", () => {
    const game = table();
    vacate(game, 1, { midHand: false });
    const before = structuredClone(game.cumulativeScores);

    assert.equal(reclaim(game, "u-stranger"), null);
    assert.equal(reclaim(game, "u-alice"), null);
    assert.deepEqual(game.cumulativeScores, before);
    assert.ok(game.vacatedSeats.has(1));
  });

  test("clearForDeal ends the round's abandonments, weak bots and votes, but not the match's vacancies", () => {
    const game = table();
    vacate(game, 1, { midHand: true });
    castEndMatchVote(game, "u-alice", true);
    assert.equal(game.endMatchVotes.size, 1);

    clearForDeal(game);

    assert.equal(game.abandonedSeats.size, 0);
    assert.equal(game.weakSeats.size, 0);
    assert.equal(game.endMatchVotes.size, 0);
    assert.ok(game.vacatedSeats.has(1));
    assert.ok(game.releasedSeats.has("u-drita"));
    assert.equal(reclaim(game, "u-drita"), 1);
  });

  test("castEndMatchVote adds and withdraws a vote", () => {
    const game = table();
    castEndMatchVote(game, "u-alice", true);
    assert.deepEqual([...game.endMatchVotes], ["u-alice"]);
    castEndMatchVote(game, "u-alice", false);
    assert.equal(game.endMatchVotes.size, 0);
  });
});
