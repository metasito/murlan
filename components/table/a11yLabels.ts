// The table's screen-reader sentences.
//
// `gameTableModel.ts` decides what is worth saying and in what order, and takes
// every phrase already translated — it is pure, and node runs it. This file is
// the translation boundary on the other side of that contract: it turns game
// state into words. Nothing here renders, so it stays a `.ts`.

import type { Card, Combination, GameState } from "@/lib/gameEngine";
import {
  rankSpokenName,
  cardSpokenName,
  suitSpokenName,
  type TFn,
} from "@/lib/cardNames";
import type { TnFn, TranslationKey } from "@/lib/i18n";
import {
  getCardDisplayRank,
  getSuitSymbol,
} from "@/lib/gameEngine";
import {
  straightTopRankChar,
  type PlayButtonLabel,
  type TableA11yStrings,
} from "@/components/gameTableModel";

/**
 * The translation boundary for why a play is refused. Total, so a new reason
 * cannot reach a screen reader without a sentence of its own.
 */
const PLAY_SPOKEN_KEYS: Record<PlayButtonLabel, TranslationKey> = {
  play: "gameTable.playA11ySpokenNothingSelected",
  notACombination: "gameTable.playA11ySpokenInvalid",
  needsStartCard: "gameTable.playA11ySpokenStartCard",
  royalUnbeatable: "gameTable.playA11ySpokenRoyalUnbeatable",
  bombOnly: "gameTable.playA11ySpokenBombOnly",
  wrongType: "gameTable.playA11ySpokenWrongType",
  wrongLength: "gameTable.playA11ySpokenWrongLength",
  tooLow: "gameTable.playA11ySpokenTooLow",
};

/**
 * Spoken form of a played combination — richer than getComboLabel's chip text,
 * which a sighted player pairs with the cards they can see: "pair of 8s", not
 * "Pair". For a straight only the top card is named, since that is what decides
 * whether a reply beats it.
 */
export function lastPlayLabel(combo: Combination, t: TFn): string {
  switch (combo.type) {
    case "single":
      return cardSpokenName(combo.cards[0], t);
    case "pair":
      return t("gameTable.a11yLastPlayPair", { rank: rankSpokenName(combo.cards[0].rank, t) });
    case "triple":
      return t("gameTable.a11yLastPlayTriple", { rank: rankSpokenName(combo.cards[0].rank, t) });
    case "bomb":
      return t("gameTable.a11yLastPlayBomb", { rank: rankSpokenName(combo.cards[0].rank, t) });
    case "straight":
      return t("gameTable.a11yLastPlayStraight", {
        count: combo.cards.length,
        rank: rankSpokenName(straightTopRankChar(combo.strength), t),
      });
    case "royal_straight":
      return t("gameTable.a11yLastPlayRoyalStraight", {
        count: combo.cards.length,
        rank: rankSpokenName(straightTopRankChar(combo.strength), t),
        suit: suitSpokenName(combo.cards[0].suit, t),
      });
  }
}

/** Every phrase `describeTableForA11y` asks for, in the active locale. */
export function tableStrings(t: TFn, tn: TnFn): TableA11yStrings {
  return {
    yourTurn: t("gameTable.a11yYourTurn"),
    turnOf: (name) => t("gameTable.a11yTurnOf", { name }),
    emptyTable: t("gameTable.a11yEmptyTable"),
    youPlayed: (label) => t("gameTable.a11yYouPlayed", { label }),
    playerPlayed: (name, label) => t("gameTable.a11yPlayerPlayed", { name, label }),
    opponentCardCount: (name, count) => tn("gameTable.a11yOpponentCards", count, { name }),
    yourCardCount: (count) => tn("gameTable.a11yYourCards", count),
    exchangeGiveCard: (loserName) => t("gameTable.a11yExchangeGive", { name: loserName }),
    exchangeWaitForCard: (winnerName) => t("gameTable.a11yExchangeWait", { name: winnerName }),
  };
}

/** What the top bar names, which is the pile alone rather than the whole table. */
export function topBarLabel(
  current: Combination | null,
  playedByViewer: boolean,
  playerName: string,
  t: TFn
): string {
  if (current === null) return t("gameTable.a11yEmptyTable");
  const label = lastPlayLabel(current, t);
  return playedByViewer
    ? t("gameTable.a11yYouPlayed", { label })
    : t("gameTable.a11yPlayerPlayed", { name: playerName, label });
}

export function handLabel(cardCount: number, selectedCount: number, tn: TnFn): string {
  const count = tn("gameTable.a11yHandCount", cardCount);
  if (selectedCount === 0) return count;
  return `${count} ${tn("gameTable.a11yHandSelected", selectedCount)}`;
}

/** Announced after a drag, so the new position is heard rather than seen. */
export function arrangedLabel(
  card: Card | undefined,
  toIndex: number,
  handSize: number,
  t: TFn
): string | null {
  if (card === undefined) return null;
  return t("gameTable.a11yCardMoved", {
    card: cardSpokenName(card, t),
    position: toIndex + 1,
    total: handSize,
  });
}

/**
 * Why GIOCA is dim, as a sentence: what the screen reader speaks and what the
 * toast shows when the refusal is tapped. `playButtonLabel` answers "play" to
 * three different questions — not your turn, your hand is over, nothing
 * selected — and only the last is about the selection, so the first two are
 * decided here rather than in the model.
 *
 * Only the start-card reason reads the card. At 2 players the opening card can
 * be the fallback "lowest dealt card" rather than the 3♠ (docs/RULES.md §4).
 */
export function playRefusalLabel(
  refusal: { dimLabel: PlayButtonLabel; isMyTurn: boolean; isFinished: boolean; startCard: GameState["startCard"] },
  t: TFn
): string {
  const key = !refusal.isMyTurn
    ? "gameTable.playA11ySpokenNotYourTurn"
    : refusal.isFinished
      ? "gameTable.playA11ySpokenYouAreDone"
      : PLAY_SPOKEN_KEYS[refusal.dimLabel];
  const card = refusal.startCard;
  return t(key, {
    rank: card ? getCardDisplayRank(card.rank) : "",
    suit: card ? getSuitSymbol(card.suit) : "",
    card: card ? cardSpokenName(card, t) : "",
  });
}
