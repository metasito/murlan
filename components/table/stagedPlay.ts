// What the cards a player has picked up amount to, and whether GIOCA will take
// them.
//
// Relative and extensioned, not `@/`: these are runtime imports — docs/agents/checks.md,
// "Node's TypeScript loader".
import {
  checkSelection,
  getAllValidPlays,
  type Card,
  type Combination,
  type GameState,
  type SelectionRefusal,
} from "../../lib/game/gameEngine.ts";

/** Why GIOCA is dim: the engine's code, or "play" when the selection is not what is wrong. */
export type PlayButtonLabel = "play" | SelectionRefusal;

export interface StagedPlay {
  /** The selection as cards, in hand order. */
  cards: Card[];
  /** The rules accept them *and* it is this player's turn. What GIOCA is lit by. */
  playable: boolean;
  /** Why not, when it is not. Two words for the button, a key for the sentence. */
  refusal: PlayButtonLabel;
}

export type TableFacts = {
  hand: Card[];
  lastPlayedCombination: Combination | null;
  startCard: GameState["startCard"];
  firstPlayMade: boolean;
  isNewTrick: boolean;
  isMyTurn: boolean;
  isFinished: boolean;
};

function whatMustBeMet(input: TableFacts) {
  return {
    toBeat: input.isNewTrick ? null : input.lastPlayedCombination,
    requiredCard: !input.firstPlayMade && input.startCard ? input.startCard : undefined,
  };
}

/** Some selection of this hand is legal right now — so PASSA is a choice, not the only move. */
export function canBeatPileOf(input: TableFacts): boolean {
  if (!input.isMyTurn || input.isFinished) return false;
  const { toBeat, requiredCard } = whatMustBeMet(input);
  return getAllValidPlays(input.hand, toBeat, input.isNewTrick, requiredCard).length > 0;
}

export function readStagedPlay(input: TableFacts & { selectedIds: string[] }): StagedPlay {
  const cards = input.hand.filter((c) => input.selectedIds.includes(c.id));
  const { toBeat } = whatMustBeMet(input);
  const check = checkSelection(cards, {
    lastPlayedCombination: toBeat,
    firstPlayMade: input.firstPlayMade,
    startCard: input.startCard,
  });
  const myMove = input.isMyTurn && !input.isFinished;
  return {
    cards,
    playable: check.ok && myMove,
    refusal: !myMove || input.selectedIds.length === 0 || check.ok ? "play" : check.code,
  };
}
