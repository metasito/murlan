// tests/botCardMemory.test.ts — the game records what has been played, and the
// bots that are supposed to be good use it.
//
// Before this, no bot at any difficulty could know a 2 or a joker was already
// gone, so every one of them played every trick as though the deck were full: a
// human counting cards had strictly more information than the hardest bot in
// the game (#350).
//
// The tally counts ranks, never card identities. It is public information —
// every seat watched those cards land — so it is broadcast unsanitised, and it
// is built from plays alone: never from a hand, never from the deck. At two
// seats the twelve undealt cards therefore read as still outstanding, which
// makes the bot slightly too cautious and never over-confident. That direction
// is deliberate; see the ticket.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  aiChoosePlay,
  bombPossible,
  buildCombination,
  createDeck,
  getRankStrength,
  initializeGame,
  outstandingAbove,
  processPlay,
  RANK_SLOTS,
} from "../lib/gameEngine.ts";
import { c, j, makePlayer, makeState } from "./helpers.ts";
import type { Card, GameState, Rank } from "../lib/gameEngine.ts";

const seats = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    name: `bot${i}`,
    type: "ai" as const,
    personality: "gent" as const,
  }));

/** Every card still in a hand, across the whole table. */
const allHands = (state: GameState): Card[] => state.players.flatMap((p) => p.hand);

const tallyOf = (cards: Card[]): number[] => {
  const t = new Array<number>(RANK_SLOTS).fill(0);
  for (const card of cards) t[getRankStrength(card.rank)] += 1;
  return t;
};

describe("the game records what has been played", () => {
  test("a fresh deal starts with an empty tally", () => {
    for (const n of [2, 3, 4]) {
      const state = initializeGame(seats(n), "free_for_all");
      assert.deepEqual(
        state.playedRanks,
        new Array<number>(RANK_SLOTS).fill(0),
        `${n} seats`
      );
    }
  });

  test("every card that leaves a hand is counted, at 2, 3 and 4 seats", () => {
    for (const n of [2, 3, 4]) {
      let state = initializeGame(seats(n), "free_for_all");
      const dealt = tallyOf(allHands(state));

      // Drive the table with the engine's own chooser until the hand ends, so
      // the plays are real ones rather than a fixture's idea of them.
      for (let turn = 0; turn < 400 && !state.gameOver; turn++) {
        const player = state.players[state.currentTurnIndex];
        if (player.hand.length === 0) break;
        const others = state.players
          .filter((p) => p.id !== player.id)
          .map((p) => p.hand.length);
        const choice = aiChoosePlay(
          player,
          state.lastPlayedCombination,
          state.lastPlayedCombination === null,
          others,
          state.firstPlayMade ? undefined : state.startCard,
          () => 0.5,
          false,
          state.playedRanks
        );
        if (!choice) break;
        state = processPlay(state, choice);
      }

      // Whatever is no longer in a hand is what was played. Nothing else can
      // have moved it: the exchange is not part of this hand.
      const remaining = tallyOf(allHands(state));
      const expected = dealt.map((count, i) => count - remaining[i]);

      assert.deepEqual(state.playedRanks, expected, `${n} seats`);
      assert.ok(
        expected.some((n2) => n2 > 0),
        `${n} seats: the drive played nothing, so this asserts nothing`
      );
    }
  });

  test("the tally counts ranks, not identities — four 3s read as four", () => {
    const hand = [c("3", "hearts"), c("3", "spades"), c("4", "hearts")];
    let state = makeState([makePlayer("p1", hand), makePlayer("p2", [c("5", "clubs")])], {
      playedRanks: new Array<number>(RANK_SLOTS).fill(0),
      firstPlayMade: true,
    });
    state = processPlay(state, buildCombination([hand[0], hand[1]])!);

    assert.equal(state.playedRanks![getRankStrength("3")], 2);
    assert.equal(state.playedRanks![getRankStrength("4")], 0);
  });
});

describe("outstandingAbove counts what can still beat a card", () => {
  const empty = new Array<number>(RANK_SLOTS).fill(0);

  test("at the start, everything above a 3 is still out there", () => {
    // 54 cards, minus the four 3s, minus nothing played and nothing held.
    assert.equal(outstandingAbove(getRankStrength("3"), empty, []), 50);
  });

  test("nothing outstanding beats the coloured joker", () => {
    assert.equal(outstandingAbove(getRankStrength("joker_colored"), empty, []), 0);
  });

  test("cards in my own hand are not outstanding", () => {
    const mine = [j("colored"), j("bw"), c("2", "hearts")];
    // Above an ace: four 2s and two jokers exist; I hold three of them.
    assert.equal(outstandingAbove(getRankStrength("A"), empty, mine), 3);
  });

  test("cards already played are not outstanding", () => {
    const played = [...empty];
    played[getRankStrength("2")] = 4;
    played[getRankStrength("joker_bw")] = 1;
    // Only the coloured joker is left above an ace.
    assert.equal(outstandingAbove(getRankStrength("A"), played, []), 1);
  });

  test("an absent tally means nothing is known to be played", () => {
    assert.equal(
      outstandingAbove(getRankStrength("A"), undefined, []),
      outstandingAbove(getRankStrength("A"), empty, [])
    );
  });
});

describe("bombPossible answers the half rank can still decide", () => {
  test("a fresh deck is all bombs waiting to happen", () => {
    assert.equal(bombPossible(new Array<number>(RANK_SLOTS).fill(0), []), true);
  });

  test("no rank missing all four means no bomb", () => {
    const played = new Array<number>(RANK_SLOTS).fill(0);
    for (const rank of NORMAL_RANKS) played[getRankStrength(rank)] = 1;
    assert.equal(bombPossible(played, []), false);
  });

  test("holding one of the four myself is enough to rule that rank out", () => {
    const played = new Array<number>(RANK_SLOTS).fill(0);
    for (const rank of NORMAL_RANKS) played[getRankStrength(rank)] = 1;
    played[getRankStrength("7")] = 0;
    assert.equal(bombPossible(played, []), true);
    assert.equal(bombPossible(played, [c("7", "hearts")]), false);
  });

  test("jokers are never a bomb — only one of each exists", () => {
    const played = new Array<number>(RANK_SLOTS).fill(0);
    for (const rank of NORMAL_RANKS) played[getRankStrength(rank)] = 1;
    assert.equal(bombPossible(played, []), false);
  });
});

const NORMAL_RANKS: Rank[] = [
  "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A", "2",
];

/**
 * A table where the bot leads, with `hand`, and `played` already gone.
 *
 * One card of every rank is played by default, which is what makes a bomb
 * impossible: `docs/RULES.md` §7.2 lets a bomb beat any single, so a lead is
 * only safe once no rank is missing all four. A fixture that left the deck
 * otherwise untouched would be asserting on a board where the bot is right
 * not to lead.
 */
function leadWith(hand: Card[], played: Partial<Record<Rank, number>>, personality: string) {
  const playedRanks = new Array<number>(RANK_SLOTS).fill(0);
  for (const rank of NORMAL_RANKS) playedRanks[getRankStrength(rank)] = 1;
  for (const [rank, n] of Object.entries(played)) {
    playedRanks[getRankStrength(rank as Rank)] = n as number;
  }
  const me = makePlayer("me", hand, { type: "ai", personality: personality as never });
  return { me, playedRanks };
}

describe("the hard bot plays what it knows", () => {
  test("leads a card nothing outstanding can beat, instead of sitting on it", () => {
    // Every 2 and the black-and-white joker are gone; I hold the coloured
    // joker. Nothing left in the game beats it, so leading it takes the round
    // for free — hoarding it wins nothing.
    const hand = [j("colored"), c("4", "hearts"), c("5", "spades"), c("7", "clubs"),
                  c("9", "hearts"), c("J", "spades"), c("Q", "clubs")];
    const { me, playedRanks } = leadWith(hand, { "2": 4, joker_bw: 1 }, "gent");

    const choice = aiChoosePlay(me, null, true, [8, 8, 8], undefined, () => 0.5, false, playedRanks);

    assert.ok(choice, "the bot must lead something");
    assert.equal(choice!.cards.length, 1);
    assert.equal(choice!.cards[0].rank, "joker_colored");
  });

  test("holds it back while a bomb could still be out there", () => {
    // The same board, except every 7 is unaccounted for. A bomb beats any
    // single at any time (docs/RULES.md §7.2), so the joker is not safe and
    // leading it hands over the round and the card.
    const hand = [j("colored"), c("4", "hearts"), c("5", "spades"), c("7", "clubs"),
                  c("9", "hearts"), c("J", "spades"), c("Q", "clubs")];
    const { me, playedRanks } = leadWith(hand, { "2": 4, joker_bw: 1 }, "gent");
    playedRanks[getRankStrength("7")] = 0;
    // The 7 in hand would otherwise account for one of the four.
    const noSeven = { ...me, hand: hand.filter((card) => card.rank !== "7") };

    const choice = aiChoosePlay(noSeven, null, true, [8, 8, 8], undefined, () => 0.5, false, playedRanks);

    assert.ok(choice, "the bot must still lead something");
    assert.notEqual(choice!.cards[0].rank, "joker_colored", "led into a possible bomb");
  });

  // A regression pin, NOT a proof of the tally: this passes with the memory
  // disabled too, because the hard tier already prefers its cheapest
  // non-premium answer and only reaches for a 2 when nothing else beats the
  // lead. #350 listed this as work; it was already done, by #223. Kept so a
  // future re-rank cannot quietly undo it.
  test("does not spend a 2 when a plain card beats the lead (already true)", () => {
    const hand = [c("2", "hearts"), c("J", "spades"), c("4", "clubs"), c("6", "hearts"),
                  c("8", "diamonds")];
    const { me, playedRanks } = leadWith(
      hand,
      { Q: 4, K: 4, A: 4, "2": 3, joker_bw: 1, joker_colored: 1 },
      "gent"
    );
    const lead = buildCombination([c("9", "clubs")])!;

    const choice = aiChoosePlay(me, lead, false, [3, 3, 3], undefined, () => 0.5, false, playedRanks);

    assert.ok(choice, "the bot can beat a 9 and must not pass");
    assert.equal(choice!.cards[0].rank, "J", "spent a 2 it did not need");
  });
});

describe("the medium bot takes an unbeatable lead and nothing more", () => {
  test("leads the unbeatable card", () => {
    const hand = [j("colored"), c("4", "hearts"), c("5", "spades"), c("7", "clubs")];
    const { me, playedRanks } = leadWith(hand, { "2": 4, joker_bw: 1 }, "drita");

    const choice = aiChoosePlay(me, null, true, [8, 8, 8], undefined, () => 0.5, false, playedRanks);

    assert.ok(choice);
    assert.equal(choice!.cards[0].rank, "joker_colored");
  });

  test("is otherwise exactly the bot it was — a beatable lead is unchanged", () => {
    const hand = [c("4", "hearts"), c("5", "spades"), c("7", "clubs"), c("9", "hearts")];
    const { me, playedRanks } = leadWith(hand, {}, "drita");

    const withMemory = aiChoosePlay(me, null, true, [8, 8, 8], undefined, () => 0.5, false, playedRanks);
    const without = aiChoosePlay(me, null, true, [8, 8, 8], undefined, () => 0.5, false, undefined);

    assert.deepEqual(withMemory?.cards.map((x) => x.id), without?.cards.map((x) => x.id));
  });
});

describe("the easy bot is untouched", () => {
  test("plays the same card with the tally as without it", () => {
    const hand = [j("colored"), c("4", "hearts"), c("5", "spades"), c("7", "clubs")];
    const { me, playedRanks } = leadWith(hand, { "2": 4, joker_bw: 1 }, "luan");

    const withMemory = aiChoosePlay(me, null, true, [8, 8, 8], undefined, () => 0.5, false, playedRanks);
    const without = aiChoosePlay(me, null, true, [8, 8, 8], undefined, () => 0.5, false, undefined);

    assert.deepEqual(withMemory?.cards.map((x) => x.id), without?.cards.map((x) => x.id));
  });
});

describe("a game rehydrated from before the tally existed", () => {
  // GameState is persisted as jsonb, so a hand in flight across a deploy comes
  // back without playedRanks. A bot reading an absent tally must behave exactly
  // as it did before it existed, and nothing may throw.
  test("chooses a legal play and does not throw", () => {
    const hand = [c("2", "hearts"), c("J", "spades"), c("4", "clubs")];
    const me = makePlayer("me", hand, { type: "ai", personality: "gent" });

    for (const lead of [null, buildCombination([c("9", "clubs")])!]) {
      const choice = aiChoosePlay(me, lead, lead === null, [5, 5, 5], undefined, () => 0.5, false, undefined);
      if (choice) {
        assert.ok(choice.cards.every((card) => hand.some((h) => h.id === card.id)));
      }
    }
  });

  test("processPlay starts a tally on a state that has none", () => {
    const hand = [c("3", "hearts"), c("4", "clubs")];
    const state = makeState([makePlayer("p1", hand), makePlayer("p2", [c("5", "clubs")])], {
      firstPlayMade: true,
    });
    delete (state as { playedRanks?: number[] }).playedRanks;

    const after = processPlay(state, buildCombination([hand[0]])!);

    assert.equal(after.playedRanks?.[getRankStrength("3")], 1);
  });
});

describe("the tally is built from plays alone", () => {
  test("a full deck's worth of ranks is what the slots can hold", () => {
    const deck = createDeck();
    const total = tallyOf(deck);
    assert.equal(total.length, RANK_SLOTS);
    assert.equal(
      total.reduce((a, b) => a + b, 0),
      deck.length
    );
  });
});
