// #770 PR #799 review: a soak run only asserts a match reaches `match.over`,
// which passed 2000 seeds green even with `weakestBeatingPlay` forced to
// return the *strongest* legal beating combination instead of the weakest —
// nothing distinguished the two. This pins the ordering directly: given a
// reply with more than one legal beating card, the weaker one is chosen.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCombination, type Card, type GameState } from "../lib/gameEngine.ts";
import { weakestBeatingPlay } from "./helpers/offlineMatch.ts";

function card(id: string, rank: Card["rank"]): Card {
  return { id, suit: "hearts", rank, isJoker: false };
}

function stateWithHand(hand: Card[], onTable: Card["rank"] | null): GameState {
  const lastPlayedCombination = onTable === null ? null : buildCombination([card("table", onTable)]);
  return {
    players: [{ id: "player_0", name: "Weak", hand, type: "human" }],
    currentTurnIndex: 0,
    lastPlayedCombination,
    lastPlayedBy: 1,
    passCount: 0,
    gameMode: "free_for_all",
    roundWinner: null,
    gameOver: false,
    rankings: [],
    firstPlayMade: true,
  };
}

test("contest's move is the weakest legal beating combination, not the strongest", () => {
  const weak = card("5h", "5");
  const strong = card("Kh", "K");
  const state = stateWithHand([strong, weak], "4");

  const chosen = weakestBeatingPlay(state, 0);

  assert.ok(chosen, "expected a beating play to exist");
  assert.equal(
    chosen!.cards[0]?.id,
    weak.id,
    `expected the weakest beating card (${weak.id}), got ${chosen!.cards.map((c) => c.id).join(",")}`
  );
});

test("contest's move prefers a single over a bigger shape when leading", () => {
  // Leading is unconstrained by type, so a pair and a single are both legal
  // openers — the smaller shape is the weaker commitment.
  const pairFive = [card("5h", "5"), card("5c", "5")];
  const single = card("6h", "6");
  const state = stateWithHand([...pairFive, single], null);

  const chosen = weakestBeatingPlay(state, 0);

  assert.ok(chosen, "expected a legal lead to exist");
  assert.equal(chosen!.cards.length, 1, `expected the single-card lead, got ${chosen!.cards.length} cards`);
});
