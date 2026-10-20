import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  carrySeatScore,
  castRematchVote,
  clearRematchVotes,
  closeMatch,
  applyRoundFold,
  rollForward,
  withdrawRematchVote,
} from "../../server/game/matchLedger.ts";
import { onlineTable } from "../helpers/onlineTable.ts";

const table = () =>
  onlineTable({ roomId: "match-ledger-room", cumulativeScores: { "u-alice": 4, "bot:1": 3 }, roundsPlayed: 2 });

describe("match ledger", () => {
  test("folding a round takes its totals and verdict, counts it, and opens an empty ready gate", () => {
    const game = table();
    castRematchVote(game, "u-alice");
    const votes = game.rematchVotes;

    applyRoundFold(game, { cumulativeScores: { "u-alice": 9, "bot:1": 3 }, matchTarget: 31, matchOver: true });

    assert.deepEqual(game.cumulativeScores, { "u-alice": 9, "bot:1": 3 });
    assert.equal(game.matchTarget, 31);
    assert.equal(game.matchOver, true);
    assert.equal(game.roundsPlayed, 3);
    assert.equal(game.rematchVotes.size, 0);
    assert.notEqual(game.rematchVotes, votes);
  });

  test("closing a match marks it over, and ended by vote only when the table agreed", () => {
    const voided = table();
    closeMatch(voided, { endedByVote: false });
    assert.equal(voided.matchOver, true);
    assert.equal(voided.endedByVote, undefined);

    const agreed = table();
    closeMatch(agreed, { endedByVote: true });
    assert.equal(agreed.matchOver, true);
    assert.equal(agreed.endedByVote, true);
  });

  test("rolling forward starts the match over at the first target", () => {
    const game = table();
    closeMatch(game, { endedByVote: false });

    rollForward(game, 21);

    assert.deepEqual(game.cumulativeScores, {});
    assert.equal(game.matchTarget, 21);
    assert.equal(game.roundsPlayed, 0);
    assert.equal(game.matchOver, false);
  });

  test("carrying a seat's score moves it onto the account's own key", () => {
    const game = table();
    carrySeatScore(game, "bot:1", "u-drita");
    assert.deepEqual(game.cumulativeScores, { "u-alice": 4, "u-drita": 3 });

    carrySeatScore(game, "bot:2", "u-carl");
    assert.deepEqual(game.cumulativeScores, { "u-alice": 4, "u-drita": 3 }, "nothing to carry adds no key");
  });

  test("rematch votes are cast, withdrawn and cleared", () => {
    const game = table();
    castRematchVote(game, "u-alice");
    castRematchVote(game, "u-drita");
    withdrawRematchVote(game, "u-alice");
    assert.deepEqual([...game.rematchVotes], ["u-drita"]);
    clearRematchVotes(game);
    assert.equal(game.rematchVotes.size, 0);
  });
});
