/**
 * The local table's surface, in the four pieces a screen actually reads.
 *
 * The online counterpart is `onlineGameHooks.ts`. The two are deliberately not
 * one set: the local game has no connection and no turn clock, and its match
 * carries none of the votes and rating deltas the server's does. One hook
 * spanning both would be a union with half its fields
 * null on either side.
 *
 * Each is a projection, never a home for logic. What is genuinely one concept
 * lives in `lib/game/sharedGameFlow.ts` and both modes call it.
 */
import { useMemo } from "react";
import { useGameSession, useGameTable } from "./GameContext";

/** The hand and the ways to spend a turn. */
export function useLocalTable() {
  const { gameState, playCards, passTurn, runBotTurn } = useGameTable();
  return useMemo(
    () => ({ gameState, playCards, passTurn, runBotTurn }),
    [gameState, playCards, passTurn, runBotTurn]
  );
}

/** Starting a match, abandoning one, and picking up the one that was interrupted. Its own context: a move wakes none of its readers. */
export function useLocalSession() {
  const { setupGame, resetGame, hasSavedGame, resumeGame, restored, bootSettled } = useGameSession();
  return useMemo(
    () => ({ setupGame, resetGame, hasSavedGame, resumeGame, restored, bootSettled }),
    [setupGame, resetGame, hasSavedGame, resumeGame, restored, bootSettled]
  );
}

/** Where the match stands, and how the table goes on from it. */
export function useLocalMatch() {
  const { match, startNextRound, startNewMatch } = useGameTable();
  return useMemo(
    () => ({ match, startNextRound, startNewMatch }),
    [match, startNextRound, startNewMatch]
  );
}

/** The card that changes hands between rounds, and the banner about it. */
export function useLocalExchange() {
  const {
    exchangeAnnouncing,
    exchangeAnnounceData,
    chooseExchangeCard,
    acknowledgeExchange,
    settleExchange,
  } = useGameTable();
  return useMemo(
    () => ({
      exchangeAnnouncing,
      exchangeAnnounceData,
      chooseExchangeCard,
      acknowledgeExchange,
      settleExchange,
    }),
    [exchangeAnnouncing, exchangeAnnounceData, chooseExchangeCard, acknowledgeExchange, settleExchange]
  );
}
