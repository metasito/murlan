// Offline game screen — a thin adapter over the shared <GameTable>.
//
// Everything visual lives in components/GameTable.tsx. What is left here is
// exactly what is true offline and nowhere else: the bot turn loop, the bot's
// side of the exchange phase, a local response timer that auto-passes,
// the next round, and the end-of-match board's actions.

import React, { useCallback, useEffect, useRef, useState } from "react";
import { router } from "expo-router";
import {
  useLocalExchange,
  useLocalMatch,
  useLocalSession,
  useLocalTable,
} from "@/context/gameHooks";
import { ConfirmDialog, type ConfirmRequest } from "@/components/ConfirmDialog";
import { pickGivebackCard, TURN_TIMEOUT_MS } from "@/lib/game/gameEngine";
import { suspendBot } from "@/lib/e2eBotSuspend";
import { flushSync } from "@/lib/flushSync";
import { OFFLINE_BOT_DELAY_MS } from "@/lib/game/offlineBotDelay";
import { GameTable } from "@/components/GameTable";
import { turnKey } from "@/components/flightPhysics";
import { uiFeedback } from "@/lib/device/feedback";
import { useTranslation } from "@/lib/i18n";
import { RoundEnding } from "@/lib/theme";

// Read once at module scope, never per-call. EXPO_PUBLIC_ vars are inlined
// at bundle build time, so this only ever takes the fast path in a build the
// E2E harness produced itself (scripts/e2e-server.mjs) — production pacing
// is untouched.
const E2E_FAST = process.env.EXPO_PUBLIC_E2E_FAST === "1";

/** Local response deadline. Offline there is no server, so the client enforces it. */
export const HUMAN_TURN_SECONDS = TURN_TIMEOUT_MS / 1000;
/** Whether a capture state has asked the loop to hold (`lib/e2eBotSuspend.ts`). */
const BOT_SUSPENDED = suspendBot(E2E_FAST);

export default function GameScreen() {
  const { t } = useTranslation();
  const [autoPassed, setAutoPassed] = useState(0);
  const [confirming, setConfirming] = useState<ConfirmRequest | null>(null);
  const { gameState, playCards, passTurn, runBotTurn } = useLocalTable();
  const { resetGame, restored } = useLocalSession();
  const {
    exchangeAnnouncing,
    exchangeAnnounceData,
    exchangeHoldMsOverride,
    chooseExchangeCard,
    acknowledgeExchange,
    releaseStuckExchange,
  } = useLocalExchange();
  const { match, startNextRound, startNewMatch } = useLocalMatch();

  // Timers fire outside the render that scheduled them; refs keep them from
  // calling a stale copy of the context action. Assigned after commit, never
  // during render — every reader is a timer, which cannot run before then.
  const runBotTurnRef = useRef(runBotTurn);
  const passTurnRef = useRef(passTurn);
  const chooseExchangeRef = useRef(chooseExchangeCard);
  const releaseStuckRef = useRef(releaseStuckExchange);
  const startNextRoundRef = useRef(startNextRound);
  useEffect(() => {
    runBotTurnRef.current = runBotTurn;
    passTurnRef.current = passTurn;
    chooseExchangeRef.current = chooseExchangeCard;
    releaseStuckRef.current = releaseStuckExchange;
    startNextRoundRef.current = startNextRound;
  });

  // tests/e2e/helpers/mockupParity.ts times each bot's turn to the mockup's hand-offs.
  useEffect(() => {
    if (!BOT_SUSPENDED) return;
    const e2e = globalThis as { murlanPass?: () => void; murlanBotMove?: () => void };
    // Committed before the call returns, as a click's would be: an evaluate is no discrete event, so
    // React's scheduler would run it on a real-time task the spec's virtual clock does not hold.
    e2e.murlanPass = () => flushSync(() => passTurnRef.current());
    e2e.murlanBotMove = () => flushSync(() => runBotTurnRef.current());
    return () => {
      delete e2e.murlanPass;
      delete e2e.murlanBotMove;
    };
  }, []);

  // Pass and play seats several humans at one device, so the table belongs to
  // whichever of them is on move; a bot's turn leaves it with the first human.
  // The exchange winner keeps it until the ceremony ends, not just the phase.
  const seatOnMove = gameState?.exchangePhase && (gameState.exchangePhase.active || exchangeAnnouncing)
    ? gameState.exchangePhase.winnerIdx
    : gameState?.currentTurnIndex;
  const humanIdx =
    seatOnMove !== undefined && gameState?.players[seatOnMove]?.type === "human"
      ? seatOnMove
      : (gameState?.players.findIndex((p) => p.type === "human") ?? -1);

  // Every hook runs unconditionally, before the null guard below.

  const [roundLandedAt, setRoundLandedAt] = useState<number | null>(null);
  const roundEnding = gameState?.roundOver === true && !match.over;
  if (!roundEnding && roundLandedAt !== null) setRoundLandedAt(null);
  useEffect(() => {
    if (roundLandedAt === null) return;
    const t = setTimeout(() => startNextRoundRef.current(), roundLandedAt + RoundEnding.deal - performance.now());
    return () => clearTimeout(t);
  }, [roundLandedAt]);

  // Bot turn loop. The key identifies one bot turn — seat, pass count and the
  // combination on the table — and is null whenever no bot is on move, so an
  // update that changes neither cannot restart the "thinking" timer.
  // The exchange ends the phase the moment the card is chosen, so `active` is
  // false while the two cards are still crossing the table. A play made into
  // that is a play made over the ceremony announcing it, which is the one
  // moment every seat is watching the middle.
  const [dealing, setDealing] = useState(false);
  const botTurnKey = BOT_SUSPENDED
    ? null
    : gameState &&
        !dealing &&
        !gameState.roundOver &&
        !gameState.exchangePhase?.active &&
        !exchangeAnnouncing &&
        gameState.players[gameState.currentTurnIndex]?.type === "bot"
      ? turnKey(gameState)
      : null;

  useEffect(() => {
    if (botTurnKey === null) return;
    const t = setTimeout(() => runBotTurnRef.current(), OFFLINE_BOT_DELAY_MS);
    return () => clearTimeout(t);
  }, [botTurnKey]);

  // A bot that wins a round owes the loser a card; it gives up its weakest legal
  // one. A card id rather than the card, for the same reason as above: the
  // giveback timer must not be rescheduled by an unrelated update.
  const givebackCardId = (() => {
    const phase = gameState?.exchangePhase;
    if (!phase?.active) return undefined;
    const winner = gameState!.players[phase.winnerIdx];
    if (!winner) return undefined;
    return pickGivebackCard(winner.hand, phase.cardFromLoser?.id)?.id;
  })();
  const botGivebackCardId =
    gameState?.exchangePhase?.active &&
    gameState.players[gameState.exchangePhase.winnerIdx]?.type === "bot"
      ? givebackCardId
      : undefined;

  // The winner holds no card the rules let them give back, so no seat — human
  // or bot — can satisfy the phase and the overlay would stay up forever.
  const exchangeIsStuck = gameState?.exchangePhase?.active === true && givebackCardId === undefined;
  // The table calls this once the received card has landed and been read, so the choice follows what was seen.
  const readyRef = useRef(() => {});
  useEffect(() => {
    readyRef.current = () => {
      if (botGivebackCardId) chooseExchangeRef.current(botGivebackCardId);
      else if (exchangeIsStuck) releaseStuckRef.current();
    };
  });
  const onExchangeReady = useCallback(() => readyRef.current(), []);

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
      viewerSeat={humanIdx}
      onPlay={playCards}
      onPass={passTurn}
      onExchangeGive={chooseExchangeCard}
      onExchangeReady={onExchangeReady}
      onDealing={setDealing}
      onRoundLanded={roundEnding ? setRoundLandedAt : undefined}
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
        // Leading a trick has no deadline offline.
        includeNewTrick: false,
        // Nothing else is keeping this clock, so it can be stopped while an
        // announcement holds the table.
        pausable: true,
        // Offline there is no server to announce the deadline expiring, so the
        // turn would simply vanish. The pass sound is the table's, fired off
        // the committed state; what is added here is the warn haptic and the
        // reason, which the table floats in place of its own pass.
        onExpire: () => {
          uiFeedback("warn");
          setAutoPassed((n) => n + 1);
          passTurnRef.current();
        },
      }}
      autoPassed={autoPassed}
      exchangeAnnouncement={{
        visible: exchangeAnnouncing,
        data: exchangeAnnounceData,
        onDismiss: acknowledgeExchange,
        holdMsOverride: exchangeHoldMsOverride,
      }}
      overlays={() => <ConfirmDialog request={confirming} onClose={() => setConfirming(null)} />}
    />
  );
}
