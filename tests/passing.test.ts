// One test per clause of docs/RULES.md §9 (passing, end of a trick/round, next
// lead) plus §7.3 (what beats a bomb). §9 is six unnumbered bullets in document
// order; this file numbers them 9.1-9.6 by that order and quotes each verbatim
// (markdown emphasis stripped). Each was shown red once against a planted
// defect in lib/gameEngine.ts — flip the branch, run, restore — per
// docs/agents/RULES.md rule 6; no planted defect is part of this commit.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  buildCombination,
  c,
  canPlay,
  makePlayer,
  makeState,
  processPass,
  processPlay,
  type Card,
} from "./helpers.ts";

const pair = (rank: Parameters<typeof c>[0]): Card[] => [c(rank, "hearts"), c(rank, "clubs")];
const combo = (cards: Card[]) => buildCombination(cards)!;

describe("§9.1 — \"A player who cannot or does not wish to beat the current play passes.\"", () => {
  test("passing is accepted once a play is on the table, even for a player holding a legal beat", () => {
    // Three seats so one pass does not itself close the round (that is §9.2) —
    // this test isolates only whether the pass itself is accepted.
    const state = makeState(
      [
        makePlayer("p0", pair("7")),
        // p1 holds a strictly higher pair (9 > 5) but chooses to pass anyway —
        // the clause says "does not wish to", not "cannot".
        makePlayer("p1", pair("9")),
        makePlayer("p2", pair("J")),
      ],
      {
        currentTurnIndex: 1,
        lastPlayedBy: 0,
        lastPlayedCombination: combo(pair("5")),
      }
    );
    const next = processPass(state);
    assert.notEqual(next, state, "a pass while a play stands on the table must be accepted");
    assert.equal(next.passCount, 1);
    assert.equal(next.currentTurnIndex, 0, "the turn moves on past the passer");
  });
});

describe("§9.2 — \"Passing does not lock a player out of the round … three consecutive passes in a 4-player game (activePlayers − 1)\"", () => {
  test("4 players, all still holding cards: the round closes on the third pass, not the fourth", () => {
    let state = makeState(
      [
        makePlayer("p0", pair("7")),
        makePlayer("p1", pair("9")),
        makePlayer("p2", pair("J")),
        makePlayer("p3", pair("Q")),
      ],
      {
        currentTurnIndex: 3,
        lastPlayedBy: 0,
        lastPlayedCombination: combo(pair("5")),
      }
    );

    state = processPass(state);
    assert.equal(state.roundWinner, null, "one pass does not end the round");
    state = processPass(state);
    assert.equal(state.roundWinner, null, "two passes do not end the round");
    state = processPass(state);
    assert.equal(
      state.roundWinner,
      0,
      "the third pass (activePlayers − 1 = 3) hands the round to p0"
    );
  });

  test("a passer is not removed from the round: they can still be asked to answer again next time", () => {
    // Passing does not lock the passer out — nothing in the state marks p1 as
    // ineligible, and p1's hand is untouched.
    const state = makeState(
      [
        makePlayer("p0", pair("7")),
        makePlayer("p1", pair("9")),
        makePlayer("p2", pair("J")),
      ],
      {
        currentTurnIndex: 1,
        lastPlayedBy: 0,
        lastPlayedCombination: combo(pair("5")),
      }
    );
    const next = processPass(state);
    assert.deepEqual(next.players[1].hand.map((card) => card.id), state.players[1].hand.map((card) => card.id));
  });
});

describe("§9.3 — \"The player who made the last (unbeaten) play leads the next trick with any legal combination of their choice.\"", () => {
  test("once the round closes, the player who made the unbeaten play is on turn again", () => {
    const state = makeState(
      [makePlayer("p0", pair("7")), makePlayer("p1", pair("9"))],
      {
        currentTurnIndex: 1,
        lastPlayedBy: 0,
        lastPlayedCombination: combo(pair("5")),
      }
    );
    const next = processPass(state);
    assert.equal(next.roundWinner, 0);
    assert.equal(next.currentTurnIndex, 0, "the unbeaten play's owner leads the next trick");
    assert.equal(next.lastPlayedCombination, null, "the table is cleared for the new lead");
  });
});

describe("§9.4 — \"If that player has just gone out (played their last card), the lead passes to the next active player in turn order.\"", () => {
  test("the round winner's hand is empty, so the next active seat leads instead", () => {
    const state = makeState(
      [
        makePlayer("p0", [], { finishPosition: 1 }),
        makePlayer("p1", pair("9")),
        makePlayer("p2", pair("K")),
      ],
      {
        currentTurnIndex: 2,
        lastPlayedBy: 0,
        lastPlayedCombination: combo(pair("5")),
        rankings: ["p0"],
      }
    );
    let next = processPass(state);
    next = processPass(next);
    assert.equal(next.roundWinner, 0, "p0's play is still the one nobody beat");
    assert.notEqual(next.currentTurnIndex, 0, "p0 has gone out and cannot lead");
    assert.ok(
      next.players[next.currentTurnIndex].hand.length > 0,
      "the seat given the lead must still hold cards"
    );
  });
});

describe("§9.5 — \"A player who leads may not pass — leading requires playing something.\"", () => {
  test("passing while leading a new round (nothing on the table) is refused and changes nothing", () => {
    const state = makeState(
      [makePlayer("p0", pair("7")), makePlayer("p1", pair("9"))],
      { currentTurnIndex: 0, lastPlayedCombination: null }
    );
    const next = processPass(state);
    assert.equal(next, state, "the state is returned untouched — there is nothing to pass on");
    assert.equal(next.passCount, 0);
    assert.equal(next.currentTurnIndex, 0);
  });
});

describe("§9.6 — \"Going out … Play continues among the rest. The hand ends when only one player still holds cards; that player is last.\"", () => {
  test("a player emptying their hand is recorded in the finishing order", () => {
    const state = makeState(
      [makePlayer("p0", pair("7")), makePlayer("p1", [c("9", "spades"), c("9", "hearts")])],
      { currentTurnIndex: 0 }
    );
    const next = processPlay(state, combo(pair("7")));
    assert.equal(next.players[0].finishPosition, 1);
    assert.deepEqual(next.rankings, ["p0", "p1"], "the last player left is recorded too");
    assert.equal(next.gameOver, true, "only one player still held cards — the hand ends");
  });

  test("play continues among the rest while more than one player still holds cards", () => {
    const state = makeState(
      [
        makePlayer("p0", pair("7")),
        makePlayer("p1", [c("9", "spades"), c("9", "hearts")]),
        makePlayer("p2", [c("K", "spades"), c("K", "hearts")]),
      ],
      { currentTurnIndex: 0 }
    );
    const next = processPlay(state, combo(pair("7")));
    assert.equal(next.gameOver, false, "two players still hold cards — the hand is not over");
    assert.equal(next.players[0].finishPosition, 1);
    assert.deepEqual(next.rankings, ["p0"]);
  });
});

describe("§7.3 — \"A bomb is beaten only by a higher bomb\" — pinned against the engine's actual royal-straight exception", () => {
  // docs/BRIEF.md §3.1 ("Royal straight") already records the decision behind
  // this: keep the royal straight beating bombs, no engine change — only
  // docs/RULES.md was meant to carry the exception. §7.3 read on its own does
  // not state it; §7.4 does. This test pins what canPlay() actually does.
  const bomb5 = combo([c("5", "hearts"), c("5", "clubs"), c("5", "spades"), c("5", "diamonds")]);
  const bombK = combo([c("K", "hearts"), c("K", "clubs"), c("K", "spades"), c("K", "diamonds")]);
  const royalLow = combo([
    c("3", "spades"), c("4", "spades"), c("5", "spades"), c("6", "spades"), c("7", "spades"),
  ]);
  const royalHigh = combo([
    c("9", "hearts"), c("10", "hearts"), c("J", "hearts"), c("Q", "hearts"), c("K", "hearts"),
  ]);

  test("a bomb never beats a royal straight, even a higher bomb against a lower royal", () => {
    assert.equal(canPlay(bombK, royalLow), false, "§7.3: a bomb is beaten only by a higher bomb, never played to beat a royal straight");
  });

  test("a royal straight beats a bomb unconditionally, of any strength", () => {
    assert.equal(canPlay(royalLow, bombK), true, "§7.3/§7.4: a royal straight beats a bomb");
    assert.equal(canPlay(royalLow, bomb5), true, "§7.3/§7.4: a royal straight beats a bomb");
  });

  test("only a higher royal straight of the same length beats a royal straight", () => {
    assert.equal(canPlay(royalHigh, royalLow), true, "§7.3: only a higher royal straight beats a royal straight");
    assert.equal(canPlay(royalLow, royalHigh), false, "§7.3: only a higher royal straight beats a royal straight");
  });
});
