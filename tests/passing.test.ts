// One test per clause of docs/RULES.md §9 (passing, end of a trick/round, next
// lead), plus §7.3/§7.4 (what beats a bomb, and the royal-straight exception
// to it). §9 is six unnumbered bullets in document order; this file numbers
// them 9.1-9.6 by that order and quotes each verbatim (markdown emphasis
// stripped). Every test here was shown red once against a planted-and-reverted
// defect in lib/gameEngine.ts — flip the branch, run, restore — per
// docs/agents/RULES.md rule 6; no planted defect is part of this commit.
//
// §9.1, §9.3, §9.4, §9.5 and both §9.6 tests overlap tests/flow.test.ts's
// coverage of the same code paths (its "leader may not pass", "round end
// threshold" and turn-rotation describes); §7.3/§7.4 overlap
// tests/combinations.test.ts's canPlay() coverage. Kept anyway: this file's
// only value over those is that a failure names the clause it violates, which
// is what #773 asked for. §9.2 was rewritten (not just kept) because its
// original assertions never exercised the "last player has gone out" branch
// of the pass-count formula its own heading quotes; §7.3 gained a dedicated
// bomb-vs-bomb test for the same reason — its old assertions were all about
// §7.4's royal straight, not about §7.3's own clause.
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
    // Three seats, so a single pass does not close the round under the
    // correct threshold — but this test does not isolate itself from every
    // possible threshold defect: it only claims the pass itself is accepted.
    // §9.2 owns the pass-count formula and can still turn this red.
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
  test("the −1 applies only while the last player is still active — a player who has gone out needs every remaining active player's pass, not one fewer", () => {
    // 3 seats: p0 (the last play's owner) has gone out. activeCount = 2
    // (p1, p2). Correct passesNeeded = activeCount = 2, because p0 cannot
    // itself pass or answer — the "− 1" in the clause only ever excludes the
    // last player, and there is nothing to exclude once they have gone out.
    // A formula that subtracts 1 unconditionally closes the round after a
    // single opponent's pass, robbing the other of the chance to answer.
    let state = makeState(
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
    state = processPass(state);
    assert.equal(
      state.roundWinner,
      null,
      "one pass must not close the round while another active player can still answer"
    );
    state = processPass(state);
    assert.equal(
      state.roundWinner,
      0,
      "the second pass closes it once every remaining active player has passed"
    );
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

describe("§7.3 — \"A bomb is beaten only by a higher bomb\"", () => {
  const bomb5 = combo([c("5", "hearts"), c("5", "clubs"), c("5", "spades"), c("5", "diamonds")]);
  const bomb5Again = combo([c("5", "hearts"), c("5", "clubs"), c("5", "spades"), c("5", "diamonds")]);
  const pair8 = combo([c("8", "hearts"), c("8", "clubs")]);

  test("nothing but a strictly higher bomb beats a bomb — not a pair, and not an equal bomb", () => {
    assert.equal(canPlay(pair8, bomb5), false, "§7.3: a pair cannot beat a bomb");
    assert.equal(
      canPlay(bomb5Again, bomb5),
      false,
      "§7.3: an equal-strength bomb does not beat a bomb — strictly higher only"
    );
  });
});

describe("§7.4 — royal straight / flush: ranked above bombs, beaten only by a higher royal straight of the same length", () => {
  // docs/BRIEF.md §3.1 ("Royal straight") already records the decision behind
  // this: keep the royal straight beating bombs, no engine change — only
  // docs/RULES.md was meant to carry the exception, and §7.4 is where it
  // actually lives (§7.3 states the bomb-only rule with no mention of it).
  const bomb5 = combo([c("5", "hearts"), c("5", "clubs"), c("5", "spades"), c("5", "diamonds")]);
  const bombK = combo([c("K", "hearts"), c("K", "clubs"), c("K", "spades"), c("K", "diamonds")]);
  const royalLow = combo([
    c("3", "spades"), c("4", "spades"), c("5", "spades"), c("6", "spades"), c("7", "spades"),
  ]);
  const royalHigh = combo([
    c("9", "hearts"), c("10", "hearts"), c("J", "hearts"), c("Q", "hearts"), c("K", "hearts"),
  ]);

  test("a royal straight beats any bomb unconditionally; a bomb never beats a royal straight; only a higher same-length royal straight beats a royal straight", () => {
    assert.equal(canPlay(royalLow, bombK), true, "§7.4: a royal straight beats a bomb of any strength");
    assert.equal(canPlay(royalLow, bomb5), true, "§7.4: a royal straight beats a bomb of any strength");
    assert.equal(canPlay(bombK, royalLow), false, "§7.4: a bomb never beats a royal straight");
    assert.equal(canPlay(royalHigh, royalLow), true, "§7.4: only a higher royal straight beats a royal straight");
    assert.equal(canPlay(royalLow, royalHigh), false, "§7.4: only a higher royal straight beats a royal straight");
  });

  test("a royal straight of a different length never beats another, even with the strictly higher top card the same-length rule alone would reward", () => {
    // docs/BRIEF.md §3.1 ("Royal straight comparison"): beating a royal
    // straight requires the same card count, consistent with normal
    // straights (§6's "same length required, compare the top card"). Both
    // combos below top out on an Ace — the strongest possible top card — so
    // a length check dropped from the royal-vs-royal branch would read
    // strength alone and wrongly call this a win.
    const royalSixLowTop = combo([
      c("3", "clubs"), c("4", "clubs"), c("5", "clubs"), c("6", "clubs"), c("7", "clubs"), c("8", "clubs"),
    ]);
    const royalFiveAceTop = combo([
      c("9", "diamonds"), c("10", "diamonds"), c("J", "diamonds"), c("Q", "diamonds"), c("K", "diamonds"),
    ]);
    const royalSixAceTop = combo([
      c("9", "hearts"), c("10", "hearts"), c("J", "hearts"), c("Q", "hearts"), c("K", "hearts"), c("A", "hearts"),
    ]);
    assert.equal(
      canPlay(royalSixAceTop, royalFiveAceTop),
      false,
      "§7.4: a 6-card royal straight never beats a 5-card royal straight, whatever its top card"
    );
    assert.equal(
      canPlay(royalFiveAceTop, royalSixLowTop),
      false,
      "§7.4: a 5-card royal straight never beats a 6-card royal straight, whatever its top card"
    );

    // 6 and 8 share parity, so a comparison that checked
    // `length % 2 === length % 2` instead of exact equality would let either
    // one through here whenever strength favoured it — these fixtures are
    // built exactly to expose that gap.
    const royalEightAceTop = combo([
      c("7", "hearts"), c("8", "hearts"), c("9", "hearts"), c("10", "hearts"),
      c("J", "hearts"), c("Q", "hearts"), c("K", "hearts"), c("A", "hearts"),
    ]);
    const royalEightLowTop = combo([
      c("3", "spades"), c("4", "spades"), c("5", "spades"), c("6", "spades"),
      c("7", "spades"), c("8", "spades"), c("9", "spades"), c("10", "spades"),
    ]);
    assert.equal(
      canPlay(royalEightAceTop, royalSixLowTop),
      false,
      "§7.4: an 8-card royal straight never beats a 6-card royal straight, whatever its top card"
    );
    assert.equal(
      canPlay(royalSixAceTop, royalEightLowTop),
      false,
      "§7.4: a 6-card royal straight never beats an 8-card royal straight, whatever its top card"
    );
  });

  test("a 5-card royal straight and an 8-card royal straight never beat each other, in either direction", () => {
    // 5 and 8 are congruent mod 3 (both ≡ 2), so a comparison that checked
    // `length % 3 === length % 3` instead of exact equality would let
    // either one through here whenever strength favoured it.
    const royalFiveAceTop = combo([
      c("10", "diamonds"), c("J", "diamonds"), c("Q", "diamonds"), c("K", "diamonds"), c("A", "diamonds"),
    ]);
    const royalFiveKingTop = combo([
      c("9", "clubs"), c("10", "clubs"), c("J", "clubs"), c("Q", "clubs"), c("K", "clubs"),
    ]);
    const royalEightAceTop = combo([
      c("7", "hearts"), c("8", "hearts"), c("9", "hearts"), c("10", "hearts"),
      c("J", "hearts"), c("Q", "hearts"), c("K", "hearts"), c("A", "hearts"),
    ]);
    const royalEightLowTop = combo([
      c("3", "spades"), c("4", "spades"), c("5", "spades"), c("6", "spades"),
      c("7", "spades"), c("8", "spades"), c("9", "spades"), c("10", "spades"),
    ]);
    assert.equal(
      canPlay(royalEightAceTop, royalFiveKingTop),
      false,
      "§7.4: an 8-card royal straight never beats a 5-card royal straight, whatever its top card"
    );
    assert.equal(
      canPlay(royalFiveAceTop, royalEightLowTop),
      false,
      "§7.4: a 5-card royal straight never beats an 8-card royal straight, whatever its top card"
    );
  });

  test("§7.5 — \"Equal strength never beats.\" — an equal-strength same-length royal straight does not beat another", () => {
    const royalSevenA = combo([
      c("3", "diamonds"), c("4", "diamonds"), c("5", "diamonds"), c("6", "diamonds"),
      c("7", "diamonds"), c("8", "diamonds"), c("9", "diamonds"),
    ]);
    const royalSevenB = combo([
      c("3", "clubs"), c("4", "clubs"), c("5", "clubs"), c("6", "clubs"),
      c("7", "clubs"), c("8", "clubs"), c("9", "clubs"),
    ]);
    assert.equal(
      canPlay(royalSevenB, royalSevenA),
      false,
      "§7.5: an equal-strength same-length royal straight does not beat another — strictly higher only"
    );
  });
});
