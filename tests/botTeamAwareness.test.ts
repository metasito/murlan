// In teams the seat across the table is not an opponent. Its own file so the
// personality suite's seeded pins stay untouched — #216 requires them to.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aiChoosePlay,
  buildCombination,
  initializeGame,
  opponentsOf,
  processPass,
  processPlay,
} from "../lib/gameEngine.ts";
import { c, j, makePlayer, makeState, mulberry32 } from "./helpers.ts";
import type { Card, GameState } from "../lib/gameEngine.ts";

const TOP_PLAY = buildCombination([c("2", "spades")])!;

/**
 * Four seats, teams A/B/A/B, each holding `hands[seat]`, mid-round with
 * `TOP_PLAY` on the table — the only state in which "my partner played last"
 * and "my partner holds the round" are the same fact.
 */
function table(hands: Card[][], overrides: Partial<GameState> = {}): GameState {
  return makeState(
    hands.map((hand, seat) =>
      makePlayer(`p${seat}`, hand, {
        type: "ai",
        // Hard tier, aggression 0.85 — the tier that reaches for a bomb and the
        // knob that contests a round.
        personality: "gent",
        team: seat % 2 === 0 ? "A" : "B",
      })
    ),
    { gameMode: "teams", firstPlayMade: true, lastPlayedCombination: TOP_PLAY, ...overrides }
  );
}

/** A bomb, plus enough spare cards that playing it does not empty the hand. */
const BOMB_HAND = [
  c("9", "hearts"), c("9", "diamonds"), c("9", "clubs"), c("9", "spades"),
  c("4", "hearts"), c("6", "clubs"), c("J", "diamonds"),
];
const hasBomb = (hand: Card[]) =>
  hand.filter((card) => card.rank === "9").length === 4;

test("opponentsOf leaves the partner out of the hand counts, in teams", () => {
  const state = table([BOMB_HAND, [c("3", "clubs")], [c("5", "hearts"), c("5", "clubs")], [c("7", "spades")]]);
  // Seat 0's counts are seats 1 and 3; its partner at seat 2 is absent from
  // them whatever it holds.
  assert.deepEqual(opponentsOf(state, 0).handCounts, [1, 1]);
  assert.deepEqual(opponentsOf(state, 1).handCounts, [7, 2]);
});

test("opponentsOf counts every other seat in free-for-all", () => {
  const state = table(
    [BOMB_HAND, [c("3", "clubs")], [c("5", "hearts"), c("5", "clubs")], [c("7", "spades")]],
    { gameMode: "free_for_all" }
  );
  assert.deepEqual(opponentsOf(state, 0).handCounts, [1, 2, 1]);
});

test("opponentsOf reports a partner-held top play only in teams", () => {
  const hands = [BOMB_HAND, [c("3", "clubs")], [c("5", "hearts")], [c("7", "spades")]];
  assert.equal(opponentsOf(table(hands, { lastPlayedBy: 2 }), 0).partnerHoldsTop, true);
  assert.equal(opponentsOf(table(hands, { lastPlayedBy: 1 }), 0).partnerHoldsTop, false);
  assert.equal(opponentsOf(table(hands, { lastPlayedBy: 3 }), 0).partnerHoldsTop, false);
  assert.equal(
    opponentsOf(table(hands, { lastPlayedBy: 2, gameMode: "free_for_all" }), 0).partnerHoldsTop,
    false
  );
});

// A new round cannot be passed, and the offline loop has no forced-play
// fallback, so a null here is a frozen hand rather than a pass.
test("leading a new round is never declining to beat the partner", () => {
  const state = table(
    [BOMB_HAND, [c("3", "clubs")], [c("5", "hearts")], [c("7", "spades")]],
    { lastPlayedBy: 2, lastPlayedCombination: null }
  );
  const view = opponentsOf(state, 0);
  assert.equal(view.partnerHoldsTop, false, "there is no top play to hold");

  const choice = aiChoosePlay(
    state.players[0],
    null,
    true,
    view.handCounts,
    undefined,
    () => 0,
    // Even handed the flag directly, a lead is not a contest.
    true
  );
  assert.ok(choice, "a bot on lead must always play something");
});

// Conceding to a partner who has gone out concedes the round: `processPass`
// gives the lead to the next seat still holding cards.
test("a partner who has already gone out no longer holds the round", () => {
  const state = table(
    [BOMB_HAND, [c("3", "clubs")], [], [c("7", "spades")]],
    { lastPlayedBy: 2 }
  );
  const view = opponentsOf(state, 0);
  assert.equal(view.partnerHoldsTop, false);

  const choice = aiChoosePlay(
    state.players[0],
    TOP_PLAY,
    false,
    view.handCounts,
    undefined,
    () => 0,
    view.partnerHoldsTop
  );
  assert.equal(choice?.type, "bomb", "an opponent is one card from going out");
});

test("a bot passes rather than bomb its own partner's play", () => {
  const state = table(
    [BOMB_HAND, [c("3", "clubs")], [c("5", "hearts")], [c("7", "spades")]],
    { lastPlayedBy: 2 }
  );
  const view = opponentsOf(state, 0);

  const choice = aiChoosePlay(
    state.players[0],
    TOP_PLAY,
    false,
    view.handCounts,
    undefined,
    // A roll of 0 fires both knobs.
    () => 0,
    view.partnerHoldsTop
  );

  assert.equal(choice, null, "the partner already holds the round");
  assert.ok(hasBomb(state.players[0].hand), "and the bomb is still in hand");
});

test("the same bot still bombs an opponent about to go out", () => {
  const state = table(
    [BOMB_HAND, [c("3", "clubs")], [c("5", "hearts")], [c("7", "spades")]],
    { lastPlayedBy: 1 }
  );
  const view = opponentsOf(state, 0);
  assert.equal(Math.min(...view.handCounts), 1, "the fixture must be an emergency");

  const choice = aiChoosePlay(
    state.players[0],
    TOP_PLAY,
    false,
    view.handCounts,
    undefined,
    () => 0,
    view.partnerHoldsTop
  );

  assert.equal(choice?.type, "bomb", "the emergency branch must stay armed");
});

// Emptying the hand ends the manche in the team's favour, so the pass rule
// must sit below the finishing branch, not above it.
test("a bot that can go out still goes out on its partner's play", () => {
  const state = table(
    [[j("colored")], [c("3", "clubs")], [c("5", "hearts")], [c("7", "spades")]],
    { lastPlayedBy: 2 }
  );
  const view = opponentsOf(state, 0);
  assert.equal(view.partnerHoldsTop, true, "the fixture must be a partner-held round");

  const choice = aiChoosePlay(
    state.players[0],
    buildCombination([c("2", "clubs")])!,
    false,
    view.handCounts,
    undefined,
    () => 0,
    view.partnerHoldsTop
  );
  assert.equal(choice?.cards.length, 1, "the last card goes down");
});

// `opponentsOf` derives the partner from seat parity, while the manche-end
// scoring reads `Player.team`. They agree today only because every seating
// path assigns the team from the same rule; nothing else keeps them together,
// and a bot protecting one seat while the score credits another would be
// silent.
test("the seat opponentsOf protects is the one Player.team calls a teammate", () => {
  const state = initializeGame(
    Array.from({ length: 4 }, (_, i) => ({
      name: `bot${i}`,
      type: "ai" as const,
      personality: "gent" as const,
      team: (i % 2 === 0 ? "A" : "B") as "A" | "B",
    })),
    "teams"
  );

  for (let seat = 0; seat < 4; seat++) {
    const counted = opponentsOf(state, seat).handCounts.length;
    assert.equal(counted, 2, `seat ${seat} must see exactly two opponents`);
    const teammates = state.players.filter(
      (p, i) => i !== seat && p.team === state.players[seat].team
    );
    assert.equal(teammates.length, 4 - 1 - counted, `seat ${seat}`);
  }
});

// Every assertion above is one call. This is the only one that walks a whole
// teams hand through `opponentsOf`, so it is what would catch a pass rule that
// stalls a table rather than one that misjudges a single turn.
test("a full teams hand played through opponentsOf still reaches game over", () => {
  let state = initializeGame(
    Array.from({ length: 4 }, (_, i) => ({
      name: `bot${i}`,
      type: "ai" as const,
      personality: "gent" as const,
      team: (i % 2 === 0 ? "A" : "B") as "A" | "B",
    })),
    "teams"
  );

  const rng = mulberry32(0x7ea3);
  let turns = 0;
  while (!state.gameOver && turns < 2000) {
    turns++;
    const seat = state.currentTurnIndex;
    const isNewRound = state.lastPlayedCombination === null;
    const view = opponentsOf(state, seat);
    const requireCard = !state.firstPlayMade ? state.startCard : undefined;

    const play = aiChoosePlay(
      state.players[seat],
      isNewRound ? null : state.lastPlayedCombination,
      isNewRound,
      view.handCounts,
      requireCard,
      rng,
      view.partnerHoldsTop
    );

    assert.ok(
      play !== null || !isNewRound,
      `turn ${turns}: seat ${seat} declined to lead, which no caller can recover from`
    );
    state = play ? processPlay(state, play) : processPass(state);
  }

  assert.ok(state.gameOver, `the hand did not finish in ${turns} turns`);
  assert.equal(state.rankings.length, 4, "every seat is placed");
});
