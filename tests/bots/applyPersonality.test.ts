// The personality knobs re-rank plays the tier already had: which one comes out, at each roll.
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyPersonality } from "../../lib/game/bot.ts";
import { buildCombination, getAllValidPlays } from "../../lib/game/gameEngine.ts";
import { card as c, joker as j } from "../support/game.ts";
import type { BotDifficulty, Card, Combination } from "../../lib/game/gameEngine.ts";

const ids = (play: Combination | null) => play?.cards.map((x) => x.id) ?? null;

const legal = (hand: Card[], toBeat: Card[] | null) =>
  getAllValidPlays(hand, { toBeat: toBeat && buildCombination(toBeat)!, mustInclude: null });

const knobs = (aggression: number, unpredictability: number, difficulty: BotDifficulty = "medium") => ({
  aggression,
  unpredictability,
  difficulty,
});

const find = (plays: Combination[], cardIds: string[]) =>
  plays.find((p) => p.cards.length === cardIds.length && cardIds.every((id) => p.cards.some((x) => x.id === id)))!;

test("a knob at zero never fires, even on a roll of zero", () => {
  const answers = legal([c("J", "clubs"), c("3", "clubs")], [c("10", "spades")]);
  assert.equal(applyPersonality(null, answers, false, knobs(0, 0), () => 0), null, "contested at aggression 0");

  const leads = legal([c("9", "clubs"), c("5", "diamonds"), c("2", "hearts")], null);
  const two = find(leads, ["2_hearts"]);
  assert.deepEqual(ids(applyPersonality(two, leads, true, knobs(0, 0), () => 0)), ["5_diamonds"], "spent a 2 at aggression 0");

  const nine = find(leads, ["9_clubs"]);
  assert.equal(applyPersonality(nine, leads, true, knobs(0, 0), () => 0), nine, "swapped at unpredictability 0");
});

test("a hoarded lead goes to the weakest plain play of the longest shape", () => {
  const leads = legal([c("9", "clubs"), c("5", "diamonds"), c("2", "hearts")], null);
  const two = find(leads, ["2_hearts"]);
  assert.deepEqual(ids(applyPersonality(two, leads, true, knobs(0, 0), () => 0.5)), ["5_diamonds"]);
});

test("a hoarded answer goes to the cheapest plain answer", () => {
  const answers = legal([c("9", "clubs"), c("6", "diamonds"), c("2", "hearts")], [c("4", "spades")]);
  const two = find(answers, ["2_hearts"]);
  assert.deepEqual(ids(applyPersonality(two, answers, false, knobs(0, 0), () => 0.5)), ["6_diamonds"]);
});

test("a contested trick is taken with the cheapest answer", () => {
  const answers = legal([c("9", "clubs"), c("6", "diamonds")], [c("4", "spades")]);
  assert.deepEqual(ids(applyPersonality(null, answers, false, knobs(1, 0), () => 0.5)), ["6_diamonds"]);
});

test("a contest answers in kind with a 2 before it reaches for a bomb", () => {
  const hand = [c("2", "hearts"), c("3", "clubs"), c("3", "diamonds"), c("3", "hearts"), c("3", "spades"), c("4", "clubs")];
  const answers = legal(hand, [c("10", "spades")]);
  assert.ok(answers.some((p) => p.type === "bomb"), "fixture needs a bomb among the answers");
  assert.deepEqual(ids(applyPersonality(null, answers, false, knobs(1, 0), () => 0.5)), ["2_hearts"]);
});

test("a contest only bombs and royals can answer spends the bomb, never the royal", () => {
  const hand = [
    c("3", "clubs"), c("3", "diamonds"), c("3", "hearts"), c("3", "spades"),
    c("5", "spades"), c("6", "spades"), c("7", "spades"), c("8", "spades"), c("9", "spades"),
  ];
  const answers = legal(hand, [j("colored")]);
  assert.deepEqual(answers.map((p) => p.type).sort(), ["bomb", "royal_straight"]);
  assert.equal(applyPersonality(null, answers, false, knobs(1, 0), () => 0.5)?.type, "bomb");
});

test("a contest answers a straight with the plain one, not the one holding a 2", () => {
  const hand = [
    c("2", "hearts"), c("3", "clubs"), c("4", "diamonds"), c("5", "spades"),
    c("6", "hearts"), c("7", "clubs"), c("10", "diamonds"), c("J", "spades"),
  ];
  const answers = legal(hand, [c("A", "hearts"), c("2", "diamonds"), c("3", "hearts"), c("4", "clubs"), c("5", "hearts")]);
  assert.ok(answers.some((p) => p.cards.some((x) => x.rank === "2")), "fixture needs a straight holding the 2");
  const choice = applyPersonality(null, answers, false, knobs(1, 0), () => 0.5);
  assert.deepEqual(choice?.cards.map((x) => x.rank).sort(), ["3", "4", "5", "6", "7"].sort());
});

test("unpredictability always moves off the tier's own choice", () => {
  const leads = legal([c("3", "clubs"), c("9", "diamonds"), c("J", "spades")], null);
  const three = find(leads, ["3_clubs"]);
  assert.deepEqual(ids(applyPersonality(three, leads, true, knobs(0, 1), () => 0)), ["9_diamonds"]);
});

test("unpredictability swaps a straight only for a plain straight of its own length", () => {
  const straight = [c("3", "clubs"), c("4", "diamonds"), c("5", "hearts"), c("6", "spades"), c("7", "clubs")];
  const royal = [c("9", "hearts"), c("10", "hearts"), c("J", "hearts"), c("Q", "hearts"), c("K", "hearts")];
  const leads = legal([...straight, ...royal], null);
  const mine = find(leads, straight.map((x) => x.id));
  assert.equal(mine.type, "straight");
  assert.equal(applyPersonality(mine, leads, true, knobs(0, 1), () => 0), mine, "swapped a straight for the royal");

  const six = [...straight, c("8", "diamonds")];
  const longer = legal(six, null);
  const sixStraight = find(longer, six.map((x) => x.id));
  assert.equal(applyPersonality(sixStraight, longer, true, knobs(0, 1), () => 0), sixStraight, "swapped for a shorter straight");
});
