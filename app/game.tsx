// Offline game screen — a thin adapter over the shared <GameTable>.
//
// Everything visual lives in components/GameTable.tsx. What is left here is
// exactly what is true offline and nowhere else: the AI turn loop, the AI's
// side of the exchange phase, a local 20s response timer that auto-passes,
// and navigation to the results screen.

import React, { useEffect, useRef, useState } from "react";
import { router } from "expo-router";
import {
  useLocalExchange,
  useLocalMatch,
  useLocalSession,
  useLocalTable,
} from "@/context/gameHooks";
import { useNotification } from "@/context/NotificationContext";
import { ConfirmDialog, type ConfirmRequest } from "@/components/ConfirmDialog";
import { pickGivebackCard } from "@/lib/gameEngine";
import { suspendAI } from "@/lib/e2eAiSuspend";
import { GameTable } from "@/components/GameTable";
import { comboKey } from "@/components/gameTableModel";
import { hapticWarn } from "@/lib/haptics";
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
/** Whether a capture state has asked the loop to hold (`lib/e2eAiSuspend.ts`). */
const AI_SUSPENDED = suspendAI(E2E_FAST);

/** Ranks the exchange phase accepts as a giveback (docs/RULES.md §Exchange). */

export default function GameScreen() {
  const { t } = useTranslation();
  const { showNotification } = useNotification();
  const [confirming, setConfirming] = useState<ConfirmRequest | null>(null);
  const { gameState, selectedCards, selectCard, playSelected, passTurn, runAITurn } =
    useLocalTable();
  const { resetGame } = useLocalSession();
  const {
    exchangeAnnouncing,
    exchangeAnnounceData,
    chooseExchangeCard,
    acknowledgeExchange,
    releaseStuckExchange,
  } = useLocalExchange();
  const { rematchPromptOpen, rematchAnswers, rematchTally, answerRematch } = useLocalMatch();

  // Timers fire outside the render that scheduled them; refs keep them from
  // calling a stale copy of the context action. Assigned after commit, never
  // during render — every reader is a timer, which cannot run before then.
  const runAITurnRef = useRef(runAITurn);
  const passTurnRef = useRef(passTurn);
  const chooseExchangeRef = useRef(chooseExchangeCard);
  const releaseStuckRef = useRef(releaseStuckExchange);
  useEffect(() => {
    runAITurnRef.current = runAITurn;
    passTurnRef.current = passTurn;
    chooseExchangeRef.current = chooseExchangeCard;
    releaseStuckRef.current = releaseStuckExchange;
  });

  const humanIdx = gameState?.players.findIndex((p) => p.type === "human") ?? -1;

  // Every hook runs unconditionally, before the null guard below.

  useEffect(() => {
    if (!gameState?.gameOver) return;
    const t = setTimeout(() => router.replace("/result"), RESULT_DELAY);
    return () => clearTimeout(t);
  }, [gameState?.gameOver]);

  // AI turn loop. The key identifies one AI turn — seat, pass count and the
  // combination on the table — and is null whenever no AI is on move, so an
  // update that changes neither cannot restart the "thinking" timer.
  // The exchange ends the phase the moment the card is chosen, so `active` is
  // false while the two cards are still crossing the table. A hand played into
  // that is a hand played over the ceremony announcing it, which is the one
  // moment every seat is watching the middle.
  const aiTurnKey = AI_SUSPENDED
    ? null
    : gameState &&
        !gameState.gameOver &&
        !gameState.exchangePhase?.active &&
        !exchangeAnnouncing &&
        gameState.players[gameState.currentTurnIndex]?.type === "ai"
      ? `${gameState.currentTurnIndex}|${gameState.passCount}|` +
        (gameState.lastPlayedCombination
          ? comboKey(gameState.lastPlayedCombination, gameState.lastPlayedBy)
          : "-")
      : null;

  useEffect(() => {
    if (aiTurnKey === null) return;
    const t = setTimeout(() => runAITurnRef.current(), AI_DELAY);
    return () => clearTimeout(t);
  }, [aiTurnKey]);

  // An AI that wins a round owes the loser a card; it gives up its weakest legal
  // one. A card id rather than the card, for the same reason as above: the
  // giveback timer must not be rescheduled by an unrelated update.
  const givebackCardId = (() => {
    const phase = gameState?.exchangePhase;
    if (!phase?.active) return undefined;
    const winner = gameState!.players[phase.winnerIdx];
    if (!winner) return undefined;
    return pickGivebackCard(winner.hand, phase.cardFromLoser?.id)?.id;
  })();
  const aiGivebackCardId =
    gameState?.exchangePhase?.active &&
    gameState.players[gameState.exchangePhase.winnerIdx]?.type === "ai"
      ? givebackCardId
      : undefined;

  useEffect(() => {
    if (!aiGivebackCardId) return;
    const t = setTimeout(() => chooseExchangeRef.current(aiGivebackCardId), AI_EXCHANGE_DELAY);
    return () => clearTimeout(t);
  }, [aiGivebackCardId]);

  // The winner holds no card the rules let them give back, so no seat — human
  // or bot — can satisfy the phase and the overlay would stay up forever.
  const exchangeIsStuck = gameState?.exchangePhase?.active === true && givebackCardId === undefined;
  useEffect(() => {
    if (!exchangeIsStuck) return;
    const t = setTimeout(() => releaseStuckRef.current(), AI_EXCHANGE_DELAY);
    return () => clearTimeout(t);
  }, [exchangeIsStuck]);

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
      selectedIds={selectedCards}
      onSelectCard={selectCard}
      onPlay={playSelected}
      onPass={passTurn}
      onExchangeGive={chooseExchangeCard}
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
      turnTimer={{
        seconds: HUMAN_TURN_SECONDS,
        // Leading a round has no deadline offline.
        includeNewRound: false,
        // Offline nobody announces the deadline expiring — there is no server
        // to send the banner the online screen gets — so the turn simply
        // vanished. The pass sound is the table's, fired off the committed
        // state; what is added here is the warn haptic and the reason.
        onExpire: () => {
          hapticWarn();
          showNotification({
            type: "afk",
            title: t("game.autoPassTitle"),
            message: t("game.autoPassBody"),
          });
          passTurnRef.current();
        },
      }}
      exchangeAnnouncement={{
        visible: exchangeAnnouncing,
        data: exchangeAnnounceData,
        onDismiss: acknowledgeExchange,
      }}
      rematchPrompt={{
        visible: rematchPromptOpen,
        myAnswer,
        yesCount: rematchTally.yes,
        seatCount: rematchTally.total || gameState.players.length,
        onAnswer: answerRematch,
      }}
      overlays={() => <ConfirmDialog request={confirming} onClose={() => setConfirming(null)} />}
    />
  );
}
