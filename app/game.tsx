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
import { cardStrength } from "@/lib/gameEngine";
import { GameTable } from "@/components/GameTable";
import { useTranslation } from "@/lib/i18n";

/** How long an AI "thinks" before playing. */
const AI_DELAY = 1100;
/** How long an AI takes to pick its giveback card in the exchange phase. */
const AI_EXCHANGE_DELAY = 600;
/** Local response deadline. Offline there is no server, so the client enforces it. */
const HUMAN_TURN_SECONDS = 20;
/** Beat before the results screen takes over, so the last play is seen. */
const RESULT_DELAY = 800;

/** Ranks the exchange phase accepts as a giveback (docs/RULES.md §Exchange). */
const EXCHANGE_VALID_RANKS = new Set(["3", "4", "5", "6", "7", "8", "9", "10"]);

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
    const [weakest] = winner.hand
      .filter((c) => EXCHANGE_VALID_RANKS.has(c.rank))
      .sort((a, b) => cardStrength(a) - cardStrength(b));
    if (!weakest) return;
    const t = setTimeout(() => chooseExchangeRef.current(weakest.id), AI_EXCHANGE_DELAY);
    return () => clearTimeout(t);
  }, [gameState?.exchangePhase?.active]);

  useEffect(() => {
    if (!gameState) router.replace("/");
  }, [gameState]);

  if (!gameState) return null;

  return (
    <GameTable
      gameState={gameState}
      viewerSeat={humanIdx}
      roundLabel={t("offlineGame.roundLabel")}
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
    />
  );
}
