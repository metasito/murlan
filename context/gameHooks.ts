/**
 * The local table's surface, in the four pieces a screen actually reads.
 *
 * The online counterpart is `onlineGameHooks.ts`. The two are deliberately not
 * one set: the local game has no connection and no turn clock, its match
 * carries a tally and a local majority where the server's carries votes and
 * rating deltas, and card selection is local state the online screen does not
 * have. One hook spanning both would be a union with half its fields null on
 * either side.
 *
 * Each is a projection, never a home for logic. What is genuinely one concept
 * lives in `lib/sharedGameFlow.ts` and both modes call it.
 */
import { useMemo } from "react";
import { useGame } from "./GameContext";

/** The hand, what is picked out of it, and the ways to spend a turn. */
export function useLocalTable() {
  const { gameState, selectedCards, selectCard, playSelected, passTurn, runAITurn } = useGame();
  return useMemo(
    () => ({ gameState, selectedCards, selectCard, playSelected, passTurn, runAITurn }),
    [gameState, selectedCards, selectCard, playSelected, passTurn, runAITurn]
  );
}

/** Starting a game, abandoning one, and picking up the one that was interrupted. */
export function useLocalSession() {
  const { setupGame, resetGame, hasSavedGame, resumeGame } = useGame();
  return useMemo(
    () => ({ setupGame, resetGame, hasSavedGame, resumeGame }),
    [setupGame, resetGame, hasSavedGame, resumeGame]
  );
}

/** Where the match stands, and whether the table wants another. */
export function useLocalMatch() {
  const {
    match,
    rematchAnswers,
    rematchTally,
    tableWantsRematch,
    rematchPromptOpen,
    answerRematch,
    startNextHand,
    startNewMatch,
  } = useGame();
  return useMemo(
    () => ({
      match,
      rematchAnswers,
      rematchTally,
      tableWantsRematch,
      rematchPromptOpen,
      answerRematch,
      startNextHand,
      startNewMatch,
    }),
    [
      match,
      rematchAnswers,
      rematchTally,
      tableWantsRematch,
      rematchPromptOpen,
      answerRematch,
      startNextHand,
      startNewMatch,
    ]
  );
}

/** The card that changes hands between manches, and the banner about it. */
export function useLocalExchange() {
  const { exchangeAnnouncing, exchangeAnnounceData, chooseExchangeCard, acknowledgeExchange } =
    useGame();
  return useMemo(
    () => ({ exchangeAnnouncing, exchangeAnnounceData, chooseExchangeCard, acknowledgeExchange }),
    [exchangeAnnouncing, exchangeAnnounceData, chooseExchangeCard, acknowledgeExchange]
  );
}
