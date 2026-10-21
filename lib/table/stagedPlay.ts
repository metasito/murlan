// What the cards a player has picked up amount to, and whether GIOCA will take
// them.
//
// Relative and extensioned, not `@/`: these are runtime imports — docs/agents/checks.md,
// "Node's TypeScript loader".
import {
  checkSelection,
  getAllValidPlays,
  type Card,
  type SelectionRefusal,
  type TableDemand,
} from "../game/gameEngine.ts";

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
  demand: TableDemand;
  isMyTurn: boolean;
  isFinished: boolean;
};

/** Some selection of this hand is legal right now — so PASSA is a choice, not the only move. */
export function canBeatPileOf(input: TableFacts): boolean {
  if (!input.isMyTurn || input.isFinished) return false;
  return getAllValidPlays(input.hand, input.demand).length > 0;
}

export function readStagedPlay(input: TableFacts & { selectedIds: string[] }): StagedPlay {
  const cards = input.hand.filter((c) => input.selectedIds.includes(c.id));
  const check = checkSelection(cards, input.demand);
  const myMove = input.isMyTurn && !input.isFinished;
  return {
    cards,
    playable: check.ok && myMove,
    refusal: !myMove || input.selectedIds.length === 0 || check.ok ? "play" : check.code,
  };
}
