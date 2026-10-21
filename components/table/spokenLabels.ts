// The table's screen-reader sentences.
//
// `tableA11y.ts` decides what is worth saying and in what order, and takes
// every phrase already translated — it is pure, and node runs it. This file is
// the translation boundary on the other side of that contract: it turns game
// state into words. Nothing here renders, so it stays a `.ts`.

import {
  getCardDisplayRank,
  getSuitSymbol,
  type Card,
  type Combination,
  type SelectionRefusal,
} from "../../lib/game/gameEngine.ts";
import { comboName } from "../../lib/comboName.ts";
import { rankSpokenName, cardSpokenName, suitSpokenName } from "../../lib/cardNames.ts";
import {
  translateServerPayload,
  type ServerPayload,
  type TFn,
  type TnFn,
  type TranslationKey,
} from "../../lib/i18n.ts";
import { straightTopRankChar } from "./straightTopRank.ts";
import type { PlayButtonLabel } from "@/components/table/stagedPlay";
import type { TableA11yStrings } from "@/components/tableA11y";

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

/** The combination chip's text: its kind, and how many cards once there are more than two. */
export function comboLabel(combo: Combination | null, t: TFn): string | null {
  if (!combo) return null;
  const label = comboName(combo.type, t);
  if (combo.cards.length > 2) return `${label}${t("gameShared.comboMultiplier", { count: combo.cards.length })}`;
  return label;
}

/**
 * Spoken form of a played combination — richer than comboLabel's chip text,
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
    roundOver: t("gameTable.a11yRoundOver"),
    matchOver: t("gameTable.a11yMatchOver"),
    dealing: t("gameTable.a11yDealing"),
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
 * toast shows when the refusal is tapped.
 *
 * Only the start-card reason reads the card. At 2 players the opening card can
 * be the fallback "lowest dealt card" rather than the 3♠ (docs/GAME-RULES.md §4).
 */
export function playRefusalLabel(
  play: {
    refusal: PlayButtonLabel;
    isMyTurn: boolean;
    isFinished: boolean;
    openingCard: Card | null;
  },
  t: TFn
): string {
  const key = !play.isMyTurn
    ? "gameTable.playA11ySpokenNotYourTurn"
    : play.isFinished
      ? "gameTable.playA11ySpokenYouAreDone"
      : PLAY_SPOKEN_KEYS[play.refusal];
  const card = play.openingCard;
  return t(key, {
    rank: card ? getCardDisplayRank(card.rank) : "",
    suit: card ? getSuitSymbol(card.suit) : "",
    card: card ? cardSpokenName(card, t) : "",
  });
}

/** The float's text for a `game:error`: a refused selection in GIOCA's words, anything else as the server coded it. */
export function gameErrorText(payload: ServerPayload, openingCard: Card | null, t: TFn): string {
  const refusal = payload.params?.refusal;
  if (
    payload.code !== "INVALID_MOVE" ||
    typeof refusal !== "string" ||
    refusal === "play" ||
    !Object.hasOwn(PLAY_SPOKEN_KEYS, refusal)
  ) {
    return translateServerPayload(payload);
  }
  return playRefusalLabel({ refusal: refusal as SelectionRefusal, isMyTurn: true, isFinished: false, openingCard }, t);
}
