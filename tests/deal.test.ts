import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  c,
  cardStrength,
  createDeck,
  dealCards,
  findStartingPlayer,
  getCardDisplayRank,
  getSuitSymbol,
  initializeGame,
  j,
  makePlayer,
  nextDealFirstSeat,
  shuffleDeck,
  type Card,
} from "./helpers.ts";
import { translate, DEFAULT_LOCALE } from "../shared/i18n.ts";

const ids = (cards: Card[]) => cards.map((card) => card.id);

describe("deck", () => {
  test("is 52 cards plus 2 distinguishable jokers", () => {
    const deck = createDeck();
    assert.equal(deck.length, 54);
    assert.equal(deck.filter((card) => card.isJoker).length, 2);
    assert.equal(new Set(ids(deck)).size, 54, "every card id is unique");
    assert.ok(deck.some((card) => card.rank === "joker_bw"));
    assert.ok(deck.some((card) => card.rank === "joker_colored"));
  });

  test("shuffle is a permutation, never a mutation of the input", () => {
    const deck = createDeck();
    const before = ids(deck);
    const shuffled = shuffleDeck(deck);
    assert.deepEqual(ids(deck), before, "input deck is untouched");
    assert.deepEqual(ids(shuffled).sort(), [...before].sort());
  });

  test("shuffle actually shuffles and is not stuck on one ordering", () => {
    const orderings = new Set<string>();
    for (let i = 0; i < 20; i++) orderings.add(ids(shuffleDeck(createDeck())).join(","));
    assert.ok(orderings.size > 15, "20 shuffles should produce distinct orderings");
  });

  test("shuffle covers the whole range (no dead first position)", () => {
    const firsts = new Set<string>();
    for (let i = 0; i < 300; i++) firsts.add(shuffleDeck(createDeck())[0].id);
    assert.ok(firsts.size > 30, `only ${firsts.size} distinct first cards in 300 shuffles`);
  });
});

describe("the deal (defect 3) — the whole deck goes out at 3 and 4 players", () => {
  const cases: [number, number[]][] = [
    [4, [14, 14, 13, 13]],
    [3, [18, 18, 18]],
  ];

  for (const [playerCount, expected] of cases) {
    test(`${playerCount} players receive ${expected.join("/")}`, () => {
      const { hands, excluded } = dealCards(playerCount);
      assert.deepEqual(hands.map((h) => h.length), expected);
      assert.equal(excluded.length, 0, "nothing is ever excluded");
      const all = hands.flat();
      assert.equal(all.length, 54);
      assert.equal(new Set(ids(all)).size, 54, "no card is dealt twice");
    });
  }

  test("the extra cards rotate with the first seat", () => {
    assert.deepEqual(dealCards(4, 0).hands.map((h) => h.length), [14, 14, 13, 13]);
    assert.deepEqual(dealCards(4, 1).hands.map((h) => h.length), [13, 14, 14, 13]);
    assert.deepEqual(dealCards(4, 2).hands.map((h) => h.length), [13, 13, 14, 14]);
    assert.deepEqual(dealCards(4, 3).hands.map((h) => h.length), [14, 13, 13, 14]);
  });

  test("the whole deck still goes out at every offset", () => {
    for (const playerCount of [3, 4]) {
      for (let firstSeat = 0; firstSeat < playerCount; firstSeat++) {
        const { hands, excluded } = dealCards(playerCount, firstSeat);
        const all = hands.flat();
        assert.equal(excluded.length, 0);
        assert.equal(all.length, 54, `${playerCount}p from seat ${firstSeat}`);
        assert.equal(new Set(ids(all)).size, 54, "no card is dealt twice");
      }
    }
  });

  test("four consecutive manches give every seat the bigger hand", () => {
    const bigHands = new Set<number>();
    let firstSeat = 0;
    for (let manche = 0; manche < 4; manche++) {
      dealCards(4, firstSeat).hands.forEach((h, seat) => {
        if (h.length === 14) bigHands.add(seat);
      });
      firstSeat = nextDealFirstSeat(firstSeat, 4);
    }
    assert.deepEqual([...bigHands].sort(), [0, 1, 2, 3]);
  });

  test("the rotation wraps, and a stray offset is still a legal deal", () => {
    assert.equal(nextDealFirstSeat(3, 4), 0);
    assert.equal(nextDealFirstSeat(1, 2), 0);
    assert.deepEqual(dealCards(4, 4).hands.map((h) => h.length), [14, 14, 13, 13]);
    assert.deepEqual(dealCards(4, -1).hands.map((h) => h.length), [14, 13, 13, 14]);
  });

  test("both jokers and the 3 of spades are always dealt", () => {
    for (let i = 0; i < 200; i++) {
      for (const playerCount of [3, 4]) {
        const all = dealCards(playerCount).hands.flat();
        assert.ok(all.some((card) => card.rank === "joker_bw"));
        assert.ok(all.some((card) => card.rank === "joker_colored"));
        assert.ok(all.some((card) => card.rank === "3" && card.suit === "spades"));
      }
    }
  });

  test("a degenerate player count cannot crash", () => {
    assert.deepEqual(dealCards(0), { hands: [], excluded: [] });
  });
});

describe("the deal at 2 players — 21 each, 12 undealt", () => {
  test("each hand has 21 cards and 12 stay undealt", () => {
    const { hands, excluded } = dealCards(2);
    assert.deepEqual(hands.map((h) => h.length), [21, 21]);
    assert.equal(excluded.length, 12);
  });

  test("every card is accounted for exactly once, dealt or excluded", () => {
    const { hands, excluded } = dealCards(2);
    const all = [...hands.flat(), ...excluded];
    assert.equal(all.length, 54);
    assert.equal(new Set(ids(all)).size, 54, "no card is dealt twice or dropped");
  });

  test("21 each holds at every first-seat offset", () => {
    for (const firstSeat of [0, 1, -1, 5]) {
      const { hands, excluded } = dealCards(2, firstSeat);
      assert.deepEqual(hands.map((h) => h.length), [21, 21]);
      assert.equal(excluded.length, 12);
    }
  });

  test("the 3 of spades and both jokers are not always dealt — the undealt pile can hold them", () => {
    let sawAThreeSpadesExcluded = false;
    let sawAJokerExcluded = false;
    for (let i = 0; i < 200; i++) {
      const { excluded } = dealCards(2);
      if (excluded.some((c) => c.rank === "3" && c.suit === "spades")) sawAThreeSpadesExcluded = true;
      if (excluded.some((c) => c.isJoker)) sawAJokerExcluded = true;
    }
    assert.ok(sawAThreeSpadesExcluded, "200 deals never left the 3♠ undealt — the deal is not actually stripping 12 cards");
    assert.ok(sawAJokerExcluded, "200 deals never left a Joker undealt");
  });

  test("when the 3 of spades lands in the undealt pile, the opening fallback resolves to the lowest dealt card", () => {
    let ran = false;
    for (let i = 0; i < 200; i++) {
      const { hands, excluded } = dealCards(2);
      if (!excluded.some((c) => c.rank === "3" && c.suit === "spades")) continue;
      ran = true;

      const players = hands.map((hand, idx) => makePlayer(`p${idx}`, hand));
      const { playerIdx, startCard } = findStartingPlayer(players);

      assert.notEqual(startCard.id, "3_spades", "the 3♠ was undealt — it cannot be the start card");
      const allDealt = hands.flat();
      const lowestDealt = allDealt.reduce((lowest, card) =>
        cardStrength(card) < cardStrength(lowest) ? card : lowest
      );
      assert.equal(startCard.id, lowestDealt.id);
      assert.ok(players[playerIdx].hand.some((c) => c.id === startCard.id));
    }
    assert.ok(ran, "200 deals never gave a case where the 3♠ was undealt");
  });

  test("the start-card banner names the fallback opener's actual card, not a hardcoded spade", () => {
    let ran = false;
    for (let i = 0; i < 500 && !ran; i++) {
      const { hands, excluded } = dealCards(2);
      if (!excluded.some((card) => card.rank === "3" && card.suit === "spades")) continue;

      const players = hands.map((hand, idx) => makePlayer(`p${idx}`, hand));
      const { startCard } = findStartingPlayer(players);
      if (startCard.suit === "spades") continue; // this run's fallback still happened to be a spade

      ran = true;
      const rank = getCardDisplayRank(startCard.rank);
      const suit = getSuitSymbol(startCard.suit);
      const banner = translate(DEFAULT_LOCALE, "gameTable.startCardBannerOther", {
        name: "Ana",
        rank,
        suit,
      });

      assert.ok(
        banner.includes(`${rank}${suit}`),
        `banner "${banner}" does not name the ${rank}${suit} the opener actually holds`
      );
      assert.ok(
        !banner.includes("♠"),
        `banner "${banner}" still shows a hardcoded spade for a ${suit} card`
      );
    }
    assert.ok(ran, "500 deals never gave a non-spade fallback opener to check the banner against");
  });
});

describe("findStartingPlayer (defect 4)", () => {
  test("finds the holder of the 3 of spades", () => {
    const players = [
      makePlayer("p0", [c("4", "spades"), c("K", "hearts")]),
      makePlayer("p1", [c("3", "hearts"), c("3", "spades")]),
      makePlayer("p2", [c("2", "spades")]),
    ];
    const { playerIdx, startCard } = findStartingPlayer(players);
    assert.equal(playerIdx, 1);
    assert.equal(startCard.id, "3_spades");
  });

  test("does not fall back to a lower spade when the 3 of spades exists elsewhere", () => {
    const players = [
      makePlayer("p0", [c("4", "spades")]),
      makePlayer("p1", [c("3", "spades")]),
    ];
    assert.equal(findStartingPlayer(players).playerIdx, 1);
  });

  test("defensive fallback: no 3 of spades — lowest card held wins, no crash", () => {
    const players = [
      makePlayer("p0", [c("K", "hearts"), c("9", "clubs")]),
      makePlayer("p1", [c("5", "diamonds"), j("colored")]),
    ];
    const { playerIdx, startCard } = findStartingPlayer(players);
    assert.equal(playerIdx, 1);
    assert.equal(startCard.id, "5_diamonds");
  });

  test("defensive fallback: every hand empty — returns a card instead of crashing", () => {
    const players = [makePlayer("p0", []), makePlayer("p1", [])];
    const { playerIdx, startCard } = findStartingPlayer(players);
    assert.equal(playerIdx, 0);
    assert.ok(startCard, "must not be undefined");
  });

  test("a real 4-player game always opens on the 3 of spades", () => {
    const setup = [0, 1, 2, 3].map((i) => ({ name: `p${i}`, type: "human" as const }));
    for (let i = 0; i < 100; i++) {
      const state = initializeGame(setup, "free_for_all");
      assert.equal(state.startCard?.id, "3_spades");
      assert.ok(
        state.players[state.currentTurnIndex].hand.some((card) => card.id === "3_spades"),
        "the opener must hold the start card"
      );
      assert.deepEqual(state.players.map((p) => p.hand.length), [14, 14, 13, 13]);
    }
  });
});
