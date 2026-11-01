// botChoosePlay's tiers, one constructed hand per branch, each threshold at n and n+1.
// Knobs are held still by the rng: 0.5 keeps a premium choice and never swaps it,
// 0.99 never contests a pass and trades a premium choice for a plain one when one exists.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { botChoosePlay } from "../../lib/game/bot.ts";
import type { BotView } from "../../lib/game/bot.ts";
import type { BotPersonalityId } from "../../lib/game/botPersonalities.ts";
import { buildCombination, DECK_BY_STRENGTH, getRankStrength } from "../../lib/game/gameEngine.ts";
import type { Card, Combination, Rank } from "../../lib/game/gameEngine.ts";
import { card as c, cardKey, joker as j, seat, viewOf } from "../support/game.ts";

const KEEP = () => 0.5;
const PASSIVE = () => 0.99;

const combo = (...cards: Card[]): Combination => buildCombination(cards)!;

function view(personality: BotPersonalityId, hand: Card[], over: Partial<BotView> = {}): BotView {
  return viewOf(seat(0, hand, { type: "bot", personality }), over);
}

/** A tally under which exactly `outstanding` of each rank are still out; every other card is played or held. */
function tallyLeaving(hand: Card[], outstanding: Partial<Record<Rank, number>>): number[] {
  const played = [...DECK_BY_STRENGTH];
  for (const card of hand) played[getRankStrength(card.rank)] -= 1;
  for (const [rank, n] of Object.entries(outstanding)) played[getRankStrength(rank as Rank)] -= n;
  return played;
}

/** One of each rank from 3 to K still out, nothing above: an A or a 2 led takes the trick, no bomb can exist. */
const aceIsTop = (hand: Card[]) =>
  tallyLeaving(hand, { "3": 1, "4": 1, "5": 1, "6": 1, "7": 1, "8": 1, "9": 1, "10": 1, J: 1, Q: 1, K: 1 });

const ids = (play: Combination | null | undefined) => (play ? cardKey(play.cards) : play);

const SINGLE_K = combo(c("K", "hearts"));
const SINGLE_10 = combo(c("10", "clubs"));
const SINGLE_6 = combo(c("6", "hearts"));
const SINGLE_3 = combo(c("3", "hearts"));

test("no legal play passes", () => {
  assert.equal(botChoosePlay(view("gent", [c("3", "clubs"), c("4", "clubs")], { toBeat: SINGLE_K })), null);
});

describe("a lead nothing can answer", () => {
  for (const personality of ["besnik", "gent"] as const) {
    test(`${personality} leads the cheaper of two certain singles, whatever the hand order`, () => {
      const hand = [c("2", "hearts"), c("A", "clubs"), c("4", "diamonds"), c("7", "spades")];
      const choice = botChoosePlay(view(personality, hand, { playedRanks: aceIsTop(hand) }), KEEP);
      assert.equal(ids(choice), "A_clubs");
    });

    test(`${personality} leads the certain single, not a straight that starts on it`, () => {
      const hand = [
        c("A", "clubs"), c("2", "diamonds"), c("3", "hearts"), c("4", "spades"),
        c("5", "clubs"), c("9", "diamonds"), c("J", "hearts"),
      ];
      const choice = botChoosePlay(view(personality, hand, { playedRanks: aceIsTop(hand) }), KEEP);
      assert.equal(ids(choice), "A_clubs");
    });

    test(`${personality} answering a trick still answers as cheaply as it can, certain card or not`, () => {
      const hand = [c("J", "clubs"), c("A", "diamonds"), c("4", "hearts"), c("6", "spades"), c("8", "diamonds")];
      const choice = botChoosePlay(view(personality, hand, { toBeat: SINGLE_10, playedRanks: aceIsTop(hand) }), KEEP);
      assert.equal(ids(choice), "J_clubs");
    });
  }
});

describe("medium tier", () => {
  const eight = [
    c("10", "hearts"), c("10", "diamonds"), c("10", "clubs"),
    c("8", "hearts"), c("8", "diamonds"), c("8", "clubs"),
    c("5", "hearts"), c("3", "clubs"),
  ];

  test("at 8 cards it leads its lowest single", () => {
    assert.equal(ids(botChoosePlay(view("besnik", eight), KEEP)), "3_clubs");
  });

  test("at 9 cards it leads its longest set, the cheaper of two", () => {
    const nine = [...eight, c("5", "diamonds")];
    assert.equal(ids(botChoosePlay(view("besnik", nine), KEEP)), "8_clubs,8_diamonds,8_hearts");
  });

  test("at 9 cards with only pairs it leads the cheapest pair", () => {
    const nine = [
      c("J", "hearts"), c("J", "diamonds"), c("6", "hearts"), c("6", "clubs"),
      c("3", "clubs"), c("5", "diamonds"), c("9", "spades"), c("K", "clubs"), c("A", "hearts"),
    ];
    assert.equal(ids(botChoosePlay(view("besnik", nine), KEEP)), "6_clubs,6_hearts");
  });

  test("answers with the cheapest single that beats the table, whatever the hand order", () => {
    const hand = [c("K", "clubs"), c("J", "diamonds"), c("3", "hearts"), c("4", "spades"), c("6", "clubs")];
    assert.equal(ids(botChoosePlay(view("besnik", hand, { toBeat: SINGLE_10 }), KEEP)), "J_diamonds");
  });

  test("answers a 2 with its joker before its bomb", () => {
    const hand = [
      j("bw"), c("4", "hearts"), c("4", "diamonds"), c("4", "clubs"), c("4", "spades"), c("7", "clubs"),
    ];
    const choice = botChoosePlay(view("besnik", hand, { toBeat: combo(c("2", "hearts")) }), KEEP);
    assert.equal(ids(choice), "joker_bw");
  });

  test("spends its only answer, a 2, with no one close to out, where hard holds it", () => {
    const hand = [
      c("2", "spades"), c("3", "clubs"), c("4", "diamonds"), c("6", "hearts"), c("8", "clubs"),
      c("10", "hearts"), c("Q", "diamonds"), c("3", "hearts"), c("5", "spades"), c("7", "diamonds"),
    ];
    const over = { toBeat: SINGLE_K, opponentHandCounts: [13] };
    assert.equal(ids(botChoosePlay(view("besnik", hand, over), PASSIVE)), "2_spades");
    assert.equal(botChoosePlay(view("gent", hand, over), PASSIVE), null);
  });
});

describe("hard tier: emergency bomb", () => {
  const twoBombs = [
    c("9", "hearts"), c("9", "diamonds"), c("9", "clubs"), c("9", "spades"),
    c("5", "hearts"), c("5", "diamonds"), c("5", "clubs"), c("5", "spades"),
    c("4", "clubs"),
  ];

  test("an opponent on 1 card draws the lowest bomb over a plain answer", () => {
    const choice = botChoosePlay(view("gent", twoBombs, { toBeat: SINGLE_3, opponentHandCounts: [13, 1] }), PASSIVE);
    assert.equal(ids(choice), "5_clubs,5_diamonds,5_hearts,5_spades");
  });

  test("an opponent on 2 cards gets the plain answer", () => {
    const choice = botChoosePlay(view("gent", twoBombs, { toBeat: SINGLE_3, opponentHandCounts: [2, 13] }), PASSIVE);
    assert.equal(ids(choice), "4_clubs");
  });

  test("on a lead the emergency does not apply", () => {
    const choice = botChoosePlay(view("gent", twoBombs, { opponentHandCounts: [1] }), KEEP);
    assert.equal(ids(choice), "5_clubs,5_diamonds,5_hearts");
  });

  test("with no bomb it answers plainly", () => {
    const hand = [c("7", "clubs"), c("3", "diamonds"), c("9", "hearts"), c("10", "spades"), c("J", "clubs")];
    const choice = botChoosePlay(view("gent", hand, { toBeat: SINGLE_6, opponentHandCounts: [1] }), PASSIVE);
    assert.equal(ids(choice), "7_clubs");
  });
});

describe("hard tier: leading", () => {
  test("a hand two cards from out leads the play that leaves the fewest", () => {
    const hand = [
      c("3", "clubs"), c("4", "diamonds"), c("5", "hearts"), c("6", "spades"), c("7", "clubs"),
      c("9", "diamonds"), c("J", "hearts"),
    ];
    assert.equal(ids(botChoosePlay(view("gent", hand), KEEP)), "3_clubs,4_diamonds,5_hearts,6_spades,7_clubs");
  });

  test("otherwise it leads the cheapest of its longest plain sets, whatever the hand order", () => {
    const hand = [
      c("J", "hearts"), c("J", "diamonds"), c("6", "hearts"), c("6", "clubs"),
      c("3", "clubs"), c("5", "diamonds"), c("9", "spades"), c("K", "clubs"), c("A", "hearts"),
    ];
    assert.equal(ids(botChoosePlay(view("gent", hand), KEEP)), "6_clubs,6_hearts");
  });

  test("with only 2s safe to lead it sheds them as a set and keeps the bomb", () => {
    const hand = [
      c("2", "hearts"), c("2", "diamonds"), c("2", "clubs"), c("2", "spades"),
      c("3", "clubs"), c("5", "diamonds"), c("8", "hearts"),
    ];
    const choice = botChoosePlay(view("gent", hand, { knownOpponentCard: c("K", "spades") }), KEEP);
    assert.equal(ids(choice), "2_clubs,2_diamonds,2_hearts");
  });
  test("with only a royal straight safe to lead, it leads the royal", () => {
    const hand = [
      c("3", "hearts"), c("4", "hearts"), c("5", "hearts"), c("6", "hearts"), c("7", "hearts"),
      c("9", "clubs"), c("10", "clubs"), c("J", "diamonds"), c("Q", "spades"),
    ];
    const choice = botChoosePlay(view("gent", hand, { knownOpponentCard: c("K", "spades") }), KEEP);
    assert.equal(ids(choice), "3_hearts,4_hearts,5_hearts,6_hearts,7_hearts");
  });
});

describe("hard tier: answering", () => {
  test("at 3 cards it answers with its cheapest single, whatever the hand order", () => {
    const hand = [c("J", "clubs"), c("7", "diamonds"), c("3", "hearts")];
    assert.equal(ids(botChoosePlay(view("gent", hand, { toBeat: SINGLE_6 }), KEEP)), "7_diamonds");
  });

  test("with plenty of cards it answers with its cheapest plain single", () => {
    const hand = [
      c("K", "clubs"), c("J", "diamonds"), c("2", "hearts"), c("3", "hearts"), c("4", "spades"),
      c("6", "clubs"), c("7", "hearts"), c("8", "spades"), c("5", "diamonds"), c("3", "spades"),
    ];
    assert.equal(ids(botChoosePlay(view("gent", hand, { toBeat: SINGLE_10 }), PASSIVE)), "J_diamonds");
  });

  const onlyHigh = (high: Card, size: number) =>
    [high, c("3", "clubs"), c("4", "diamonds"), c("6", "hearts"), c("8", "clubs"),
      c("10", "hearts"), c("Q", "diamonds"), c("3", "hearts"), c("5", "spades"), c("7", "diamonds")].slice(0, size);

  for (const high of [c("2", "spades"), j("bw")]) {
    test(`holds back its only answer, ${high.id}, at 7 cards with no one close`, () => {
      const choice = botChoosePlay(view("gent", onlyHigh(high, 7), { toBeat: SINGLE_K }), PASSIVE);
      assert.equal(choice, null);
    });

    test(`spends its only answer, ${high.id}, at 6 cards`, () => {
      const choice = botChoosePlay(view("gent", onlyHigh(high, 6), { toBeat: SINGLE_K }), PASSIVE);
      assert.equal(ids(choice), high.id);
    });

    test(`spends its only answer, ${high.id}, at 10 cards with an opponent on 3`, () => {
      const over = { toBeat: SINGLE_K, opponentHandCounts: [3, 13] };
      assert.equal(ids(botChoosePlay(view("gent", onlyHigh(high, 10), over), PASSIVE)), high.id);
    });

    test(`holds back its only answer, ${high.id}, at 10 cards with an opponent on 4`, () => {
      const over = { toBeat: SINGLE_K, opponentHandCounts: [4, 13] };
      assert.equal(botChoosePlay(view("gent", onlyHigh(high, 10), over), PASSIVE), null);
    });
  }

  test("with two high answers it spends the 2 before the joker", () => {
    const hand = [j("bw"), c("2", "spades"), c("3", "clubs"), c("4", "diamonds"), c("6", "hearts"), c("8", "clubs")];
    assert.equal(ids(botChoosePlay(view("gent", hand, { toBeat: SINGLE_K }), PASSIVE)), "2_spades");
  });

  const straightThroughTwo = [
    c("2", "clubs"), c("3", "diamonds"), c("4", "hearts"), c("5", "spades"), c("6", "clubs"),
    c("9", "diamonds"), c("J", "hearts"), c("9", "clubs"), c("J", "spades"), c("K", "hearts"),
  ];
  const lowStraight = combo(c("A", "hearts"), c("2", "diamonds"), c("3", "clubs"), c("4", "spades"), c("5", "hearts"));

  test("answers a straight with its only straight, one through a 2, at 6 cards", () => {
    const choice = botChoosePlay(view("gent", straightThroughTwo.slice(0, 6), { toBeat: lowStraight }), PASSIVE);
    assert.equal(ids(choice), "2_clubs,3_diamonds,4_hearts,5_spades,6_clubs");
  });

  test("holds back its only straight, one through a 2, at 10 cards with no one close", () => {
    assert.equal(botChoosePlay(view("gent", straightThroughTwo, { toBeat: lowStraight }), PASSIVE), null);
  });

  const bombAndSmall = [
    c("5", "hearts"), c("5", "diamonds"), c("5", "clubs"), c("5", "spades"),
    c("3", "clubs"), c("4", "diamonds"), c("6", "hearts"), c("7", "spades"), c("8", "clubs"), c("9", "diamonds"),
  ];

  test("with only a bomb to answer, an opponent on 3 draws it", () => {
    const over = { toBeat: SINGLE_K, opponentHandCounts: [3, 13] };
    assert.equal(ids(botChoosePlay(view("gent", bombAndSmall, over), PASSIVE)), "5_clubs,5_diamonds,5_hearts,5_spades");
  });

  test("with only a bomb to answer, an opponent on 4 does not", () => {
    const over = { toBeat: SINGLE_K, opponentHandCounts: [4, 13] };
    assert.equal(botChoosePlay(view("gent", bombAndSmall, over), PASSIVE), null);
  });

  test("with only a bomb to answer at 6 cards and no one close, it passes", () => {
    const over = { toBeat: SINGLE_K, opponentHandCounts: [13] };
    assert.equal(botChoosePlay(view("gent", bombAndSmall.slice(0, 6), over), PASSIVE), null);
  });

  test("with two bombs to answer, an opponent on 3 draws the lower", () => {
    const hand = [
      c("9", "hearts"), c("9", "diamonds"), c("9", "clubs"), c("9", "spades"),
      c("5", "hearts"), c("5", "diamonds"), c("5", "clubs"), c("5", "spades"),
      c("3", "clubs"), c("4", "diamonds"),
    ];
    const over = { toBeat: SINGLE_K, opponentHandCounts: [3, 13] };
    assert.equal(ids(botChoosePlay(view("gent", hand, over), PASSIVE)), "5_clubs,5_diamonds,5_hearts,5_spades");
  });

  test("with only a royal straight to answer and no one close, it passes", () => {
    const hand = [
      c("8", "hearts"), c("9", "hearts"), c("10", "hearts"), c("J", "hearts"), c("Q", "hearts"),
      c("3", "clubs"), c("4", "diamonds"), c("6", "spades"), c("3", "diamonds"), c("4", "clubs"),
    ];
    const toBeat = combo(c("3", "hearts"), c("4", "spades"), c("5", "clubs"), c("6", "diamonds"), c("7", "hearts"));
    assert.equal(botChoosePlay(view("gent", hand, { toBeat }), PASSIVE), null);
  });
});
