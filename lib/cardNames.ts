// The spoken name of a card, for accessibility labels and announcements.
//
// Kept free of *runtime* imports for the same reason components/gameTableModel.ts
// is: Node's built-in TypeScript loader (`node --test`) type-strips plain .ts
// but cannot resolve the `@/` bundler alias at runtime. Type-only imports are
// erased before resolution; a value import would break the test suite.
//
// `t` is a parameter rather than a hook call so this stays pure and testable.

import type { Card } from "@/lib/gameEngine";
import type { TFn, TranslationKey } from "@/lib/i18n";

// Only the ranks whose spoken word differs from the glyph printed on the card.
// Numbers speak as themselves.
const RANK_SPOKEN_KEYS: Record<string, TranslationKey> = {
  A: "cards.rankAce",
  J: "cards.rankJack",
  Q: "cards.rankQueen",
  K: "cards.rankKing",
};

const SUIT_SPOKEN_KEYS: Record<string, TranslationKey> = {
  hearts: "cards.suitHearts",
  diamonds: "cards.suitDiamonds",
  clubs: "cards.suitClubs",
  spades: "cards.suitSpades",
};

/** "Asso", not the "A" printed on the card. A numeric rank speaks as itself. */
export function rankSpokenName(rank: string, t: TFn): string {
  const key = RANK_SPOKEN_KEYS[rank];
  return key ? t(key) : rank;
}

/** "" for a suitless card, so it can be interpolated without a guard at each call site. */
export function suitSpokenName(suit: string | null, t: TFn): string {
  const key = suit ? SUIT_SPOKEN_KEYS[suit] : undefined;
  return key ? t(key) : "";
}

/**
 * The full name of one card: "Asso di Cuori". The two jokers are named apart
 * because they are not interchangeable — the red one beats the black one.
 */
export function cardSpokenName(card: Card, t: TFn): string {
  if (card.isJoker) {
    return t(card.rank === "joker_colored" ? "cardView.jokerColored" : "cardView.jokerBlack");
  }
  return t("cards.nameFormat", {
    rank: rankSpokenName(card.rank, t),
    suit: suitSpokenName(card.suit, t),
  });
}
