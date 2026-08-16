// tests/botPersonalities.test.ts — every personality must stay a legal, finite
// player. The property test in tests/gameEngine.test.ts already proves
// getAllValidPlays is complete; these prove the personality knobs never reach
// outside it and never stall a hand.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BOT_PERSONALITIES,
  DEFAULT_BOT_PERSONALITY,
  botSeatNames,
  getBotPersonality,
  isBotPersonalityId,
} from "../lib/botPersonalities.ts";
import {
  aiChoosePlay,
  buildCombination,
  getAllValidPlays,
  initializeGame,
  processPass,
  processPlay,
} from "../lib/gameEngine.ts";
import { c, makePlayer } from "./helpers.ts";
import type { GameState } from "../lib/gameEngine.ts";
import type { BotPersonalityId } from "../lib/botPersonalities.ts";

/** Deterministic stand-in for Math.random: a repeating fixed sequence. */
function fixedRng(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

function botTable(personality: BotPersonalityId, seats = 4): GameState {
  return initializeGame(
    Array.from({ length: seats }, (_, i) => ({
      name: `bot${i}`,
      type: "ai" as const,
      personality,
    })),
    "free_for_all"
  );
}

/**
 * Runs a whole hand with every seat on `personality`, asserting at each step
 * that the chosen play was one getAllValidPlays offered. Returns the turns taken.
 */
function playOutHand(personality: BotPersonalityId, rng: () => number): number {
  let state = botTable(personality);
  let turns = 0;
  const limit = 2000;

  while (!state.gameOver && turns < limit) {
    turns++;
    const seat = state.currentTurnIndex;
    const player = state.players[seat];
    const isNewRound = state.lastPlayedCombination === null;
    const requireCard = !state.firstPlayMade ? state.startCard : undefined;
    const legal = getAllValidPlays(
      player.hand,
      isNewRound ? null : state.lastPlayedCombination,
      isNewRound,
      requireCard
    );

    const choice = aiChoosePlay(
      player,
      isNewRound ? null : state.lastPlayedCombination,
      isNewRound,
      state.players.filter((_, i) => i !== seat).map((p) => p.hand.length),
      requireCard,
      rng
    );

    if (choice) {
      // aiChoosePlay enumerates its own candidates, so compare by content:
      // same combination type over the same card ids.
      const key = (c: { type: string; cards: { id: string }[] }) =>
        `${c.type}:${c.cards.map((x) => x.id).sort().join(",")}`;
      assert.ok(
        legal.some((p) => key(p) === key(choice)),
        `${personality} returned a play getAllValidPlays did not offer`
      );
      state = processPlay(state, choice);
      continue;
    }

    assert.ok(!isNewRound, `${personality} passed while leading a round`);
    state = processPass(state);
  }

  assert.ok(state.gameOver, `${personality} did not finish a hand in ${limit} turns`);
  return turns;
}

for (const p of BOT_PERSONALITIES) {
  test(`${p.id} finishes hands and only ever plays legal combinations`, () => {
    // Three rng sequences: never fires the knobs, always fires them, and a mix.
    for (const rng of [fixedRng([0.99]), fixedRng([0]), fixedRng([0.1, 0.9, 0.5, 0.3])]) {
      for (let round = 0; round < 5; round++) playOutHand(p.id, rng);
    }
  });
}

test("personalities are distinguishable, not just named", () => {
  const ids = BOT_PERSONALITIES.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
  const traits = BOT_PERSONALITIES.map((p) => `${p.difficulty}|${p.aggression}|${p.unpredictability}`);
  assert.equal(new Set(traits).size, traits.length);
});

// The two knobs have to change the play, not just the label. Both positions
// below are ones the strategy tier resolves identically for every personality,
// so any difference in the answer comes from the personality alone.

test("aggression decides whether a round is contested or conceded", () => {
  // Eight cards, the only legal answers to a 10 are the two 2s, and no opponent
  // is close to finishing — the hard tier concedes the round here.
  const hand = [c("2", "hearts"), c("2", "diamonds"), c("3", "clubs"), c("4", "clubs"),
    c("5", "clubs"), c("6", "clubs"), c("7", "clubs"), c("9", "clubs")];
  const lastPlayed = buildCombination([c("10", "spades")])!;
  const ask = (personality: BotPersonalityId) =>
    aiChoosePlay(makePlayer("bot", hand, { type: "ai", personality }), lastPlayed, false,
      [7, 7, 7], undefined, fixedRng([0.5]));

  assert.equal(ask("ana"), null, "a patient personality lets the round go");
  assert.deepEqual(ask("gent")?.cards.map((x) => x.rank), ["2"], "a ruthless one spends a 2 to take it");
});

test("aggression decides whether a lead spends premium cards", () => {
  // Leading with nine cards: the medium tier's longest multi-card play is the
  // triple of 2s, and a plain pair is available instead.
  const hand = [c("2", "hearts"), c("2", "diamonds"), c("2", "clubs"), c("3", "hearts"),
    c("3", "diamonds"), c("5", "clubs"), c("7", "diamonds"), c("9", "spades"), c("J", "clubs")];
  const ask = (personality: BotPersonalityId) =>
    aiChoosePlay(makePlayer("bot", hand, { type: "ai", personality }), null, true,
      [9, 9, 9], undefined, fixedRng([0.5]));

  assert.deepEqual(ask("besnik")?.cards.map((x) => x.rank), ["2", "2", "2"], "an aggressive lead dumps the 2s");
  assert.ok(
    !ask("drita")!.cards.some((x) => x.rank === "2"),
    "a cautious lead keeps them"
  );
});

test("an unknown or missing personality resolves to the default", () => {
  assert.equal(getBotPersonality(undefined).id, DEFAULT_BOT_PERSONALITY);
  assert.equal(getBotPersonality("not-a-personality").id, DEFAULT_BOT_PERSONALITY);
  assert.equal(isBotPersonalityId("not-a-personality"), false);
  assert.equal(isBotPersonalityId("ana"), true);
});

test("botSeatNames numbers only the repeated personalities", () => {
  assert.deepEqual(botSeatNames(["ana", "gent", "ana"]), ["Ana 1", "Gent", "Ana 2"]);
  assert.deepEqual(botSeatNames([]), []);
});
