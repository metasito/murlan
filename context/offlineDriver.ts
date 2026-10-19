// What keeps the offline table moving with nobody else at it: the bot turn loop, the next deal once a
// round has landed, the response deadline, and the bot's side of the exchange. The screen maps it onto
// <GameTable>; the moves themselves are the provider's commands, and a bot's is chosen in lib/game/autoMove.ts.
import { useCallback, useEffect, useState } from "react";
import { Platform } from "react-native";
import { useLocalExchange, useLocalMatch, useLocalTable } from "@/context/gameHooks";
import { TURN_TIMEOUT_MS } from "@/lib/game/gameEngine";
import type { ExchangeHold } from "@/lib/game/sharedGameFlow";
import { e2e, e2eFast } from "@/lib/e2eConfig";
import { flushSync } from "@/lib/flushSync";
import { OFFLINE_BOT_DELAY_MS } from "@/lib/timeline/offlineBotDelay";
import { turnKey } from "@/components/flightPhysics";
import { uiFeedback } from "@/lib/device/feedback";
import { RoundEnding } from "@/lib/theme";

/** Local response deadline. Offline there is no server, so the client enforces it. */
export const HUMAN_TURN_SECONDS = TURN_TIMEOUT_MS / 1000;

/**
 * How long the offline exchange overlay holds in an e2e build. Under Maestro it
 * holds until `.maestro/exchange-phase.yaml` taps it: no fixed hold covers how
 * long a device can keep Maestro from reading the screen. One view-hierarchy
 * read on the Android emulator took 22 s while the round ended, and a Passa tap
 * returned 37.5 s later, past the whole ceremony (#1560).
 * The web build keeps a timed hold, because Playwright specs play through the
 * exchange without ever tapping it.
 */
const MEASURED_TAP_RETURN_MS = 8200;
const E2E_EXCHANGE_HOLD_MARGIN_MS = 4000;
const E2E_EXCHANGE_HOLD: ExchangeHold =
  Platform.OS === "web" ? MEASURED_TAP_RETURN_MS + E2E_EXCHANGE_HOLD_MARGIN_MS : "untilTapped";
/** Set only in an e2e build (#915), unless a spec opted out; undefined for a real player. */
const EXCHANGE_HOLD = e2eFast() && !e2e.realExchange ? E2E_EXCHANGE_HOLD : undefined;

export interface OfflineDriver {
  viewerSeat: number;
  autoPassed: number;
  /** The table has shown the received card, so the choice follows what was seen. */
  onExchangeReady: () => void;
  onDealing: (dealing: boolean) => void;
  onRoundLanded: ((landsAt: number) => void) | undefined;
  turnTimer: { seconds: number; includeNewTrick: false; pausable: true; onExpire: () => void };
  exchangeHold: ExchangeHold | undefined;
}

/** Null-safe, so the screen calls it before its `if (!gameState)`. */
export function useOfflineDriver(): OfflineDriver {
  const { gameState, passTurn, runBotTurn } = useLocalTable();
  const { exchangeAnnouncing, settleExchange } = useLocalExchange();
  const { match, startNextRound } = useLocalMatch();
  const [autoPassed, setAutoPassed] = useState(0);

  // tests/e2e/helpers/mockupParity.ts times each bot's turn to the mockup's hand-offs.
  useEffect(() => {
    if (!e2e.suspendBot) return;
    const globals = globalThis as { murlanPass?: () => void; murlanBotMove?: () => void };
    // Committed before the call returns, as a click's would be: an evaluate is no discrete event, so
    // React's scheduler would run it on a real-time task the spec's virtual clock does not hold.
    globals.murlanPass = () => flushSync(() => passTurn());
    globals.murlanBotMove = () => flushSync(() => runBotTurn());
    return () => {
      delete globals.murlanPass;
      delete globals.murlanBotMove;
    };
  }, [passTurn, runBotTurn]);

  // Pass and play seats several humans at one device, so the table belongs to
  // whichever of them is on move; a bot's turn leaves it with the first human.
  // The exchange winner keeps it until the ceremony ends, not just the phase.
  const seatOnMove = gameState?.exchangePhase && (gameState.exchangePhase.active || exchangeAnnouncing)
    ? gameState.exchangePhase.winnerIdx
    : gameState?.currentTurnIndex;
  const viewerSeat =
    seatOnMove !== undefined && gameState?.players[seatOnMove]?.type === "human"
      ? seatOnMove
      : (gameState?.players.findIndex((p) => p.type === "human") ?? -1);

  const [roundLandedAt, setRoundLandedAt] = useState<number | null>(null);
  const roundEnding = gameState?.roundOver === true && !match.over;
  if (!roundEnding && roundLandedAt !== null) setRoundLandedAt(null);
  useEffect(() => {
    if (roundLandedAt === null) return;
    const t = setTimeout(startNextRound, roundLandedAt + RoundEnding.deal - performance.now());
    return () => clearTimeout(t);
  }, [roundLandedAt, startNextRound]);

  // Bot turn loop. The key identifies one bot turn — seat, pass count and the
  // combination on the table — and is null whenever no bot is on move, so an
  // update that changes neither cannot restart the "thinking" timer.
  // The exchange ends the phase the moment the card is chosen, so `active` is
  // false while the two cards are still crossing the table. A play made into
  // that is a play made over the ceremony announcing it, which is the one
  // moment every seat is watching the middle.
  const [dealing, setDealing] = useState(false);
  const botTurnKey = e2e.suspendBot
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
    const t = setTimeout(runBotTurn, OFFLINE_BOT_DELAY_MS);
    return () => clearTimeout(t);
  }, [botTurnKey, runBotTurn]);

  // Offline there is no server to announce the deadline expiring, so the
  // turn would simply vanish. The pass sound is the table's, fired off
  // the committed state; what is added here is the warn haptic and the
  // reason, which the table floats in place of its own pass.
  const onExpire = useCallback(() => {
    uiFeedback("warn");
    setAutoPassed((n) => n + 1);
    passTurn();
  }, [passTurn]);

  return {
    viewerSeat,
    autoPassed,
    onExchangeReady: settleExchange,
    onDealing: setDealing,
    onRoundLanded: roundEnding ? setRoundLandedAt : undefined,
    // Leading a trick has no deadline offline; nothing else is keeping this clock, so it can be stopped
    // while an announcement holds the table.
    turnTimer: { seconds: HUMAN_TURN_SECONDS, includeNewTrick: false, pausable: true, onExpire },
    exchangeHold: EXCHANGE_HOLD,
  };
}
