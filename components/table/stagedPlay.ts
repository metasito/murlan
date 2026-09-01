// What the cards a player has picked up amount to, and whether GIOCA will take
// them.
//
// Its own file rather than `gameTableModel.ts`, which imports `lib/gameEngine`
// *type-only* by design so node can run the whole model without the rules —
// see `playButtonLabel`'s docstring, which states that only the caller can run
// `canPlay`. This file is that caller, and it runs the engine for real.

// Relative and extensioned, not `@/`: these are runtime imports, and Node's
// built-in TypeScript loader (`node --test`) cannot resolve the bundler alias.
import {
  buildCombination,
  canPlay,
  type Card,
  type Combination,
  type GameState,
} from "../../lib/gameEngine.ts";
import { playButtonLabel, type PlayButtonLabel } from "../gameTableModel.ts";

export interface StagedPlay {
  /** The selection as cards, in hand order. */
  cards: Card[];
  /** The rules accept them *and* it is this player's turn. What GIOCA is lit by. */
  playable: boolean;
  /** Why not, when it is not. Two words for the button, a key for the sentence. */
  refusal: PlayButtonLabel;
}

export function readStagedPlay(input: {
  hand: Card[];
  selectedIds: string[];
  lastPlayedCombination: Combination | null;
  startCard: GameState["startCard"];
  firstPlayMade: boolean;
  isNewRound: boolean;
  isMyTurn: boolean;
  isFinished: boolean;
}): StagedPlay {
  const cards = input.hand.filter((c) => input.selectedIds.includes(c.id));
  const combo = cards.length > 0 ? buildCombination(cards) : null;
  const requiresStartCard = !input.firstPlayMade && !!input.startCard;
  const selectionHasStartCard =
    !!input.startCard && cards.some((c) => c.id === input.startCard!.id);

  const isValid =
    combo !== null &&
    canPlay(combo, input.isNewRound ? null : input.lastPlayedCombination) &&
    (!requiresStartCard || selectionHasStartCard);

  const pile = input.lastPlayedCombination;
  return {
    cards,
    playable: isValid && input.isMyTurn && !input.isFinished,
    refusal: playButtonLabel({
      isMyTurn: input.isMyTurn,
      isFinished: input.isFinished,
      selectedCount: input.selectedIds.length,
      selection: combo ? { type: combo.type, length: combo.cards.length } : null,
      pile: pile ? { type: pile.type, length: pile.cards.length } : null,
      requiresStartCard,
      selectionHasStartCard,
    }),
  };
}
