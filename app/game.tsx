// Offline game screen — a thin adapter over the shared <GameTable>.
//
// Everything visual lives in components/GameTable.tsx. What is left here is
// exactly what is true offline and nowhere else: the AI turn loop, the AI's
// side of the exchange phase, a local 20s response timer that auto-passes,
// and navigation to the results screen.

import React, { useEffect, useRef } from "react";
import { Alert } from "react-native";
import { router } from "expo-router";
import { useGame } from "@/context/GameContext";
import { pickGivebackCard } from "@/lib/gameEngine";
import { GameTable } from "@/components/GameTable";
import { useTranslation } from "@/lib/i18n";

// Read once at module scope, never per-call. EXPO_PUBLIC_ vars are inlined
// at bundle build time, so this only ever takes the fast path in a build the
// E2E harness produced itself (scripts/e2e-server.mjs) — production pacing
// is untouched.
const E2E_FAST = process.env.EXPO_PUBLIC_E2E_FAST === "1";

/** How long an AI "thinks" before playing. */
const AI_DELAY = E2E_FAST ? 0 : 1100;
/** How long an AI takes to pick its giveback card in the exchange phase. */
const AI_EXCHANGE_DELAY = E2E_FAST ? 0 : 600;
/** Local response deadline. Offline there is no server, so the client enforces it. */
const HUMAN_TURN_SECONDS = 20;
/** Beat before the results screen takes over, so the last play is seen. */
const RESULT_DELAY = E2E_FAST ? 0 : 800;

/** Ranks the exchange phase accepts as a giveback (docs/RULES.md §Exchange). */

export default function GameScreen() {
  const { t } = useTranslation();
  const {
    gameState,
    selectedCards,
    selectCard,
    playSelected,
    passTurn,
    resetGame,
    runAITurn,
    chooseExchangeCard,
    exchangeAnnouncing,
    exchangeAnnounceData,
    acknowledgeExchange,
    rematchPromptOpen,
    rematchAnswers,
    answerRematch,
    match,
  } = useGame();

  // Timers fire outside the render that scheduled them; refs keep them from
  // calling a stale copy of the context action.
  const runAITurnRef = useRef(runAITurn);
  runAITurnRef.current = runAITurn;
  const passTurnRef = useRef(passTurn);
  passTurnRef.current = passTurn;
  const chooseExchangeRef = useRef(chooseExchangeCard);
  chooseExchangeRef.current = chooseExchangeCard;

  const humanIdx = gameState?.players.findIndex((p) => p.type === "human") ?? -1;

  // Every hook runs unconditionally, before the null guard below.

  useEffect(() => {
    if (!gameState?.gameOver) return;
    const t = setTimeout(() => router.replace("/result"), RESULT_DELAY);
    return () => clearTimeout(t);
  }, [gameState?.gameOver]);

  // AI turn loop.
  useEffect(() => {
    if (!gameState || gameState.gameOver) return;
    if (gameState.exchangePhase?.active) return;
    if (gameState.players[gameState.currentTurnIndex]?.type !== "ai") return;
    const t = setTimeout(() => runAITurnRef.current(), AI_DELAY);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- narrow on purpose: only these fields should restart the AI timer
  }, [
    gameState?.currentTurnIndex,
    gameState?.gameOver,
    gameState?.passCount,
    gameState?.lastPlayedCombination,
    gameState?.exchangePhase?.active,
  ]);

  // An AI that wins a round owes the loser a card; it gives up its weakest legal one.
  useEffect(() => {
    if (!gameState?.exchangePhase?.active) return;
    const winner = gameState.players[gameState.exchangePhase.winnerIdx];
    if (winner?.type !== "ai") return;
    const weakest = pickGivebackCard(winner.hand);
    if (!weakest) return;
    const t = setTimeout(() => chooseExchangeRef.current(weakest.id), AI_EXCHANGE_DELAY);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- narrow on purpose: winnerIdx is fixed for the duration of an active exchange phase
  }, [gameState?.exchangePhase?.active]);

  useEffect(() => {
    if (!gameState) router.replace("/");
  }, [gameState]);

  if (!gameState) return null;

  const humanId = gameState.players[humanIdx]?.id;
  const myAnswer = humanId !== undefined && humanId in rematchAnswers ? rematchAnswers[humanId] : null;

  return (
    <GameTable
      gameState={gameState}
      viewerSeat={humanIdx}
      roundLabel={
        match.length === "single"
          ? t("result.singleHandFormat")
          : t("gameTable.formatMatch", { target: match.target })
      }
      selectedIds={selectedCards}
      onSelectCard={selectCard}
      onPlay={playSelected}
      onPass={passTurn}
      onExchangeGive={chooseExchangeCard}
      onQuit={() =>
        Alert.alert(t("offlineGame.quitConfirmTitle"), t("offlineGame.quitConfirmBody"), [
          { text: t("common.cancel"), style: "cancel" },
          {
            text: t("offlineGame.quitConfirmConfirm"),
            style: "destructive",
            onPress: () => {
              resetGame();
              router.replace("/");
            },
          },
        ])
      }
      turnTimer={{
        seconds: HUMAN_TURN_SECONDS,
        // Leading a round has no deadline offline.
        includeNewRound: false,
        onExpire: () => passTurnRef.current(),
      }}
      exchangeAnnouncement={{
        visible: exchangeAnnouncing,
        data: exchangeAnnounceData,
        onDismiss: acknowledgeExchange,
      }}
      rematchPrompt={{
        visible: rematchPromptOpen,
        myAnswer,
        yesCount: Object.values(rematchAnswers).filter(Boolean).length,
        seatCount: gameState.players.length,
        onAnswer: answerRematch,
      }}
    />
  );
}
