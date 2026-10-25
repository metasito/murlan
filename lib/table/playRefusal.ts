import { getCardDisplayRank, getSuitSymbol, type Card } from "../game/gameEngine.ts";
import { cardSpokenName } from "../cardNames.ts";
import type { TFn, TranslationKey } from "../i18n.ts";
import type { PlayButtonLabel } from "./stagedPlay.ts";

/**
 * The translation boundary for why a play is refused. Total, so a new reason
 * cannot reach a screen reader without a sentence of its own.
 */
export const PLAY_SPOKEN_KEYS: Record<PlayButtonLabel, TranslationKey> = {
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
