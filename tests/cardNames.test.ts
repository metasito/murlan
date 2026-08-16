// tests/cardNames.test.ts — the name a screen reader speaks for a card. This
// logic had been copied into four places that had each drifted: one spoke the
// printed glyph ("A di Cuori") instead of the word, one collapsed both jokers
// into a single name even though they differ in strength, and one never got
// localized at all. Pinned here so the shared version cannot drift back.
//
// `t` is built from the real Italian catalogue rather than a stub, so a
// renamed or deleted key fails these tests instead of silently producing
// "undefined di undefined".
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { Card, Rank, Suit } from "../lib/gameEngine.ts";
import { cardSpokenName, rankSpokenName, suitSpokenName } from "../lib/cardNames.ts";
import { it } from "../locales/it.ts";

const t = (key: string, params?: Record<string, string | number>): string => {
  const template = (it as Record<string, string>)[key];
  assert.ok(template !== undefined, `locales/it.ts has no key "${key}"`);
  return template.replace(/\{\{(\w+)\}\}/g, (_m, name: string) =>
    String(params?.[name] ?? `{{${name}}}`)
  );
};

function card(rank: Rank, suit: Suit | null, isJoker = false): Card {
  return { id: `${rank}-${suit}`, rank, suit, isJoker } as Card;
}

describe("cardSpokenName", () => {
  test("names a number card by its number and suit", () => {
    assert.equal(cardSpokenName(card("3", "hearts"), t), "3 di Cuori");
  });

  test("speaks the court ranks as words, not as the glyph printed on the card", () => {
    // The bug this replaces: CardView reused getCardDisplayRank, so VoiceOver
    // said "A di Picche" instead of "Asso di Picche".
    assert.equal(cardSpokenName(card("A", "spades"), t), "Asso di Picche");
    assert.equal(cardSpokenName(card("J", "clubs"), t), "Fante di Fiori");
    assert.equal(cardSpokenName(card("Q", "diamonds"), t), "Donna di Quadri");
    assert.equal(cardSpokenName(card("K", "hearts"), t), "Re di Cuori");
  });

  test("the two jokers are named apart — they differ in strength", () => {
    const red = cardSpokenName(card("joker_colored" as Rank, null, true), t);
    const black = cardSpokenName(card("joker_bw" as Rank, null, true), t);
    assert.equal(red, "Joker colorato");
    assert.equal(black, "Joker nero");
    assert.notEqual(red, black);
  });

  test("no card in the deck speaks a raw translation key or an empty name", () => {
    const ranks: Rank[] = ["3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A", "2"];
    const suits: Suit[] = ["hearts", "diamonds", "clubs", "spades"];
    for (const rank of ranks) {
      for (const suit of suits) {
        const name = cardSpokenName(card(rank, suit), t);
        assert.ok(name.length > 0, `${rank}/${suit} produced an empty name`);
        assert.ok(!name.includes("cards."), `${rank}/${suit} leaked a key: ${name}`);
        assert.ok(!name.includes("{{"), `${rank}/${suit} left a placeholder: ${name}`);
        assert.ok(!name.includes("undefined"), `${rank}/${suit} produced: ${name}`);
      }
    }
  });
});

describe("rankSpokenName / suitSpokenName", () => {
  test("a numeric rank speaks as itself", () => {
    assert.equal(rankSpokenName("7", t), "7");
    assert.equal(rankSpokenName("10", t), "10");
  });

  test("an absent suit contributes nothing rather than the word 'null'", () => {
    assert.equal(suitSpokenName(null, t), "");
  });

  test("an unrecognised suit degrades to empty instead of throwing", () => {
    // GameTable's copy indexed the key map unguarded, so an unexpected suit
    // threw inside an accessibilityLabel.
    assert.equal(suitSpokenName("trumps", t), "");
  });
});
