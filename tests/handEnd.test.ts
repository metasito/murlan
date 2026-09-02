import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { resolveHandEnd } from "../server/onlineGameLogic.ts";
import type { GameState, Player } from "../lib/gameEngine.ts";

function player(id: string, name: string, handSize: number, extra: Partial<Player> = {}): Player {
  return {
    id,
    name,
    hand: Array.from({ length: handSize }, () => ({ rank: "3", suit: "spades" }) as never),
    type: "human",
    ...extra,
  };
}

function mkState(players: Player[], rankings: string[]): GameState {
  return {
    players,
    currentTurnIndex: 0,
    lastPlayedCombination: null,
    lastPlayedBy: -1,
    passCount: 0,
    gameMode: "free_for_all",
    roundWinner: null,
    gameOver: true,
    rankings,
    firstPlayMade: true,
  };
}

const HAND_FLAGS = {};

describe("resolveHandEnd — free-for-all", () => {
  test("below target: keeps the same target, nobody wins yet", () => {
    const state = mkState(
      [player("p0", "Alice", 0), player("p1", "Bob", 3), player("p2", "Carl", 5), player("p3", "Dee", 8)],
      ["p0", "p1", "p2", "p3"]
    );
    const result = resolveHandEnd({
      state,
      playerMap: { 0: "alice", 1: "bob", 2: "carl", 3: "dee" },
      cumulativeScores: { alice: 5, bob: 2, carl: 1, dee: 0 },
      matchTarget: 21,
      matchLength: "match",
      gameMode: "free_for_all",
      handFlags: HAND_FLAGS,
      abandonedSeats: new Map(),
    });

    // scoreHand awards 3/2/1/0 for 4 players — alice reaches 8, still under 21.
    assert.deepEqual(result.cumulativeScores, { alice: 8, bob: 4, carl: 2, dee: 0 });
    assert.equal(result.matchOver, false);
    assert.equal(result.matchTarget, 21);
    assert.deepEqual(result.matchWinners, []);
  });

  test("at target: the sole leader wins the match", () => {
    const state = mkState(
      [player("p0", "Alice", 0), player("p1", "Bob", 3), player("p2", "Carl", 5), player("p3", "Dee", 8)],
      ["p0", "p1", "p2", "p3"]
    );
    const result = resolveHandEnd({
      state,
      playerMap: { 0: "alice", 1: "bob", 2: "carl", 3: "dee" },
      cumulativeScores: { alice: 18, bob: 2, carl: 1, dee: 0 },
      matchTarget: 21,
      matchLength: "match",
      gameMode: "free_for_all",
      handFlags: HAND_FLAGS,
      abandonedSeats: new Map(),
    });

    assert.equal(result.matchOver, true);
    assert.equal(result.isDraw, false);
    assert.deepEqual(result.matchWinners, ["alice"]);
    assert.deepEqual(result.winnerEngineIds, ["p0"]);
  });

  test("two crossing the target at once escalates instead of ending", () => {
    const state = mkState(
      [player("p0", "Alice", 0), player("p1", "Bob", 0), player("p2", "Carl", 5), player("p3", "Dee", 8)],
      ["p0", "p1", "p2", "p3"]
    );
    const result = resolveHandEnd({
      state,
      playerMap: { 0: "alice", 1: "bob", 2: "carl", 3: "dee" },
      cumulativeScores: { alice: 19, bob: 19, carl: 1, dee: 0 },
      matchTarget: 21,
      matchLength: "match",
      gameMode: "free_for_all",
      handFlags: HAND_FLAGS,
      abandonedSeats: new Map(),
    });

    assert.equal(result.matchOver, false);
    assert.equal(result.matchTarget, 31);
    assert.deepEqual(result.matchWinners, []);
  });

  test("a tie at the final target is reported as a draw", () => {
    const state = mkState(
      [player("p0", "Alice", 0), player("p1", "Bob", 0), player("p2", "Carl", 5), player("p3", "Dee", 8)],
      ["p0", "p1", "p2", "p3"]
    );
    const result = resolveHandEnd({
      state,
      // scoreHand awards this hand's 3/2/1/0 to p0..p3 (Alice, Bob, Carl,
      // Dee) — +3 and +2 lands both leaders on exactly the final target.
      playerMap: { 0: "alice", 1: "bob", 2: "carl", 3: "dee" },
      cumulativeScores: { alice: 48, bob: 49, carl: 1, dee: 0 },
      matchTarget: 51,
      matchLength: "match",
      gameMode: "free_for_all",
      handFlags: HAND_FLAGS,
      abandonedSeats: new Map(),
    });

    assert.deepEqual(result.cumulativeScores, { alice: 51, bob: 51, carl: 2, dee: 0 });
    assert.equal(result.matchOver, true);
    assert.equal(result.isDraw, true);
    assert.deepEqual(result.matchWinners.sort(), ["alice", "bob"]);
  });
});

describe("resolveHandEnd — teams", () => {
  test("the pair's summed total decides the match, not either seat alone", () => {
    // Seats 0/2 are team A, 1/3 team B. Neither of A's members reaches 21
    // alone, but together they hold 22.
    const state = mkState(
      [
        player("p0", "A1", 0, { team: "A" }),
        player("p1", "B1", 3, { team: "B" }),
        player("p2", "A2", 0, { team: "A" }),
        player("p3", "B2", 8, { team: "B" }),
      ],
      ["p0", "p2", "p1", "p3"]
    );
    const result = resolveHandEnd({
      state,
      playerMap: { 0: "a1", 1: "b1", 2: "a2", 3: "b2" },
      cumulativeScores: { a1: 11, b1: 5, a2: 8, b2: 4 },
      matchTarget: 21,
      matchLength: "match",
      gameMode: "teams",
      handFlags: HAND_FLAGS,
      abandonedSeats: new Map(),
    });

    assert.equal(result.matchOver, true);
    assert.deepEqual(result.matchWinners.sort(), ["a1", "a2"]);
  });
});

describe("resolveHandEnd — gameResults shaping", () => {
  test("a vacated seat is scored under bot:<seat> and excluded from cumulativeScores", () => {
    const state = mkState(
      [player("p0", "Alice", 0), player("p1", "Ghost", 3), player("p2", "Carl", 5), player("p3", "Dee", 8)],
      ["p0", "p1", "p2", "p3"]
    );
    const result = resolveHandEnd({
      // Seat 1 has no playerMap entry: it is bot-controlled this hand.
      state,
      playerMap: { 0: "alice", 2: "carl", 3: "dee" },
      cumulativeScores: {},
      matchTarget: 21,
      matchLength: "match",
      gameMode: "free_for_all",
      handFlags: HAND_FLAGS,
      abandonedSeats: new Map(),
    });

    assert.equal(result.handByKey["bot:1"], 2);
    assert.equal(result.cumulativeScores["bot:1"], undefined);
    assert.ok(!("bot:1" in result.cumulativeScores));
  });

  test("a straight duel's bot seat accumulates — only a vacated one is excluded (#815)", () => {
    const state = mkState(
      [player("p0", "Alice", 3), player("p1", "Drita", 0)],
      ["p1", "p0"]
    );
    const result = resolveHandEnd({
      // Seat 1 has no playerMap entry too, but it was never a human's this
      // match — it must not read the same as seat 1 in the test above.
      state,
      playerMap: { 0: "alice" },
      cumulativeScores: {},
      matchTarget: 7,
      matchLength: "match",
      gameMode: "free_for_all",
      handFlags: HAND_FLAGS,
      abandonedSeats: new Map(),
      botSeatsAtStart: new Set([1]),
    });

    assert.equal(result.cumulativeScores["bot:1"], 1);
  });

  test("#815: a straight duel's totals sum to hands played across a run", () => {
    const players = [player("p0", "rotonmeta", 0), player("p1", "Drita", 3)];
    let cumulativeScores: Record<string, number> = {};
    const outcomes = ["p0", "p0", "p1", "p1"]; // winner of each of 4 hands
    for (const winner of outcomes) {
      const loser = winner === "p0" ? "p1" : "p0";
      const result = resolveHandEnd({
        state: mkState(players, [winner, loser]),
        playerMap: { 0: "rotonmeta" },
        cumulativeScores,
        matchTarget: 7,
        matchLength: "match",
        gameMode: "free_for_all",
        handFlags: HAND_FLAGS,
        abandonedSeats: new Map(),
        botSeatsAtStart: new Set([1]),
      });
      cumulativeScores = result.cumulativeScores;
    }

    const total = Object.values(cumulativeScores).reduce((a, b) => a + b, 0);
    assert.equal(total, outcomes.length);
  });

  test("a seat vacated between hands keeps the pre-existing exclusion, unlike a straight duel's bot", () => {
    // Two humans; rotonmeta wins hand 1. drita then leaves (vacateSeat: her
    // seat drops out of playerMap; abandonedSeats and botSeatsAtStart are
    // both left untouched, exactly as vacateSeat leaves them between hands).
    // The AI now driving her seat wins hand 2.
    const players = [player("p0", "rotonmeta", 3), player("p1", "drita", 0)];
    const hand1 = resolveHandEnd({
      state: mkState(players, ["p0", "p1"]),
      playerMap: { 0: "rotonmeta", 1: "drita" },
      cumulativeScores: {},
      matchTarget: 7,
      matchLength: "match",
      gameMode: "free_for_all",
      handFlags: HAND_FLAGS,
      abandonedSeats: new Map(),
      botSeatsAtStart: new Set(),
    });
    const hand2 = resolveHandEnd({
      state: mkState(players, ["p1", "p0"]),
      playerMap: { 0: "rotonmeta" }, // seat 1 vacated between hands
      cumulativeScores: hand1.cumulativeScores,
      matchTarget: 7,
      matchLength: "match",
      gameMode: "free_for_all",
      handFlags: HAND_FLAGS,
      abandonedSeats: new Map(),
      botSeatsAtStart: new Set(),
    });

    // The point still lands on the hand's own scoreboard...
    assert.equal(hand2.handByKey["bot:1"], 1);
    // ...but docs/BRIEF.md §3.1 ("Naming the winner of a single manche") and
    // the matching lib/gameEngine.ts contract (tests/scoring.test.ts's "keys
    // the table does not accumulate") already decide, deliberately, that a
    // vacated seat's points never join the running total a departed human's
    // own name is still attached to. That decision — not this PR — is why
    // this sum does not equal hands played; see the PR body for #815.
    const total = Object.values(hand2.cumulativeScores).reduce((a, b) => a + b, 0);
    assert.equal(total, 1);
  });

  test("opponentsFinished counts real finishers only, not auto-assigned placements", () => {
    // Only seat 0 actually emptied its hand; the hand ended there and the
    // other three are auto-ranked still holding cards.
    const state = mkState(
      [player("p0", "Alice", 0), player("p1", "Bob", 4), player("p2", "Carl", 6), player("p3", "Dee", 9)],
      ["p0", "p1", "p2", "p3"]
    );
    const result = resolveHandEnd({
      state,
      playerMap: { 0: "alice", 1: "bob", 2: "carl", 3: "dee" },
      cumulativeScores: {},
      matchTarget: 21,
      matchLength: "match",
      gameMode: "free_for_all",
      handFlags: HAND_FLAGS,
      abandonedSeats: new Map(),
    });

    const bySeat = new Map(result.gameResults.map((r, idx) => [idx, r]));
    // Seat 0 (Alice) emptied its hand: the other 0 finishers besides itself.
    assert.equal(bySeat.get(0)!.opponentsFinished, 0);
    // The other three never finished: exactly one seat (Alice) finished.
    assert.equal(bySeat.get(1)!.opponentsFinished, 1);
    assert.equal(bySeat.get(2)!.opponentsFinished, 1);
    assert.equal(bySeat.get(3)!.opponentsFinished, 1);
  });

  test("opponentsFinished when every seat finished (all-but-one, then the last)", () => {
    const state = mkState(
      [player("p0", "Alice", 0), player("p1", "Bob", 0), player("p2", "Carl", 0), player("p3", "Dee", 4)],
      ["p0", "p1", "p2", "p3"]
    );
    const result = resolveHandEnd({
      state,
      playerMap: { 0: "alice", 1: "bob", 2: "carl", 3: "dee" },
      cumulativeScores: {},
      matchTarget: 21,
      matchLength: "match",
      gameMode: "free_for_all",
      handFlags: HAND_FLAGS,
      abandonedSeats: new Map(),
    });
    const bySeat = new Map(result.gameResults.map((r, idx) => [idx, r]));
    // Three seats finished (0,1,2); seat 3 (Dee) did not.
    assert.equal(bySeat.get(3)!.opponentsFinished, 3);
    // Each finisher sees the other two finishers, not itself.
    assert.equal(bySeat.get(0)!.opponentsFinished, 2);
  });

  test("recordable is false for a one-human, bot-majority table", () => {
    const state = mkState(
      [player("p0", "Alice", 0), player("p1", "Bot1", 3), player("p2", "Bot2", 5), player("p3", "Bot3", 8)],
      ["p0", "p1", "p2", "p3"]
    );
    const result = resolveHandEnd({
      state,
      playerMap: { 0: "alice" },
      cumulativeScores: {},
      matchTarget: 21,
      matchLength: "match",
      gameMode: "free_for_all",
      handFlags: HAND_FLAGS,
      abandonedSeats: new Map(),
    });
    assert.equal(result.recordable, false);
  });

  test("recordable is true for an even human/bot split", () => {
    const state = mkState(
      [player("p0", "Alice", 0), player("p1", "Bob", 3), player("p2", "Bot1", 5), player("p3", "Bot2", 8)],
      ["p0", "p1", "p2", "p3"]
    );
    const result = resolveHandEnd({
      state,
      playerMap: { 0: "alice", 1: "bob" },
      cumulativeScores: {},
      matchTarget: 21,
      matchLength: "match",
      gameMode: "free_for_all",
      handFlags: HAND_FLAGS,
      abandonedSeats: new Map(),
    });
    assert.equal(result.recordable, true);
  });

  test("a seat abandoned mid-hand is keyed by the userId who left, not bot:<seat>", () => {
    const state = mkState(
      [player("p0", "Alice", 0), player("p1", "Left", 3), player("p2", "Carl", 5), player("p3", "Dee", 8)],
      ["p0", "p1", "p2", "p3"]
    );
    const result = resolveHandEnd({
      state,
      playerMap: { 0: "alice", 2: "carl", 3: "dee" },
      cumulativeScores: {},
      matchTarget: 21,
      matchLength: "match",
      gameMode: "free_for_all",
      handFlags: HAND_FLAGS,
      abandonedSeats: new Map([[1, "walkedOutUser"]]),
    });

    const seat1Result = result.gameResults.find((r) => r.userId === "walkedOutUser");
    assert.ok(seat1Result, "the abandoning user's own id must appear in gameResults");
    assert.equal(seat1Result!.abandoned, true);
  });
});
