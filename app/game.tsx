// Offline game screen — a thin adapter over the shared <GameTable>.
//
// Everything visual lives in components/GameTable.tsx, and what keeps the
// offline table moving lives in context/offlineDriver.ts. What is left here is
// the mapping between them, and the end-of-match board's actions.

import React, { useEffect, useState } from "react";
import { router } from "expo-router";
import {
  useLocalExchange,
  useLocalMatch,
  useLocalSession,
  useLocalTable,
} from "@/context/gameHooks";
import { useOfflineDriver } from "@/context/offlineDriver";
import { ConfirmDialog, type ConfirmRequest } from "@/components/ConfirmDialog";
import { GameTable } from "@/components/GameTable";
import { uiFeedback } from "@/lib/device/feedback";
import { useTranslation } from "@/lib/i18n";

export { HUMAN_TURN_SECONDS } from "@/context/offlineDriver";

export default function GameScreen() {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState<ConfirmRequest | null>(null);
  const { gameState, playCards, passTurn } = useLocalTable();
  const { resetGame, restored } = useLocalSession();
  const { exchangeAnnouncing, exchangeAnnounceData, chooseExchangeCard, acknowledgeExchange } = useLocalExchange();
  const { match, startNewMatch } = useLocalMatch();
  const driver = useOfflineDriver();

  useEffect(() => {
    if (!gameState) router.replace("/");
  }, [gameState]);

  if (!gameState) return null;

  const rounds = match.rounds ?? [];
  const lastPlacementPoints = rounds[rounds.length - 1]?.pointsAwarded ?? {};

  return (
    <GameTable
      gameState={gameState}
      restored={restored}
      matchOver={match.over}
      matchWinners={match.winners}
      placementPoints={lastPlacementPoints}
      matchScore={{ scores: match.scores, target: match.target, single: match.length === "single" }}
      matchActions={{
        onHome: () => {
          uiFeedback("light");
          resetGame();
          router.replace("/");
        },
        again: {
          testID: "btn-new-match",
          onPress: () => {
            uiFeedback("medium");
            startNewMatch();
          },
        },
      }}
      viewerSeat={driver.viewerSeat}
      onPlay={playCards}
      onPass={passTurn}
      onExchangeGive={chooseExchangeCard}
      onExchangeReady={driver.onExchangeReady}
      onDealing={driver.onDealing}
      onRoundLanded={driver.onRoundLanded}
      onQuit={() =>
        setConfirming({
          title: t("offlineGame.quitConfirmTitle"),
          body: t("offlineGame.quitConfirmBody"),
          cancelLabel: t("common.cancel"),
          confirmLabel: t("offlineGame.quitConfirmConfirm"),
          destructive: true,
          onConfirm: () => {
            resetGame();
            router.replace("/");
          },
        })
      }
      turnTimer={driver.turnTimer}
      autoPassed={driver.autoPassed}
      exchangeAnnouncement={{
        visible: exchangeAnnouncing,
        data: exchangeAnnounceData,
        onDismiss: acknowledgeExchange,
        holdMsOverride: driver.exchangeHold,
      }}
      overlays={() => <ConfirmDialog request={confirming} onClose={() => setConfirming(null)} />}
    />
  );
}
