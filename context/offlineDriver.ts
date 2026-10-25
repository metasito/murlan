// What keeps the offline table moving with nobody else at it: the bot turn loop, the next deal once a
// round has landed, the response deadline, and the bot's side of the exchange. The screen maps it onto
// <GameTable>; the moves themselves are the provider's commands, and a bot's is chosen in lib/game/autoMove.ts.
import { useCallback, useEffect, useState } from "react";
import { Platform } from "react-native";
import { useLocalExchange, useLocalMatch, useLocalTable } from "@/context/gameHooks";
import { TURN_TIMEOUT_MS } from "@/lib/game/gameEngine";
import type { ExchangeHold } from "@/lib/game/sharedGameFlow";
import { E2E_FAST, e2e, exchangeHold } from "@/lib/e2eConfig";
import { flushSync } from "@/lib/flushSync";
import { uiFeedback } from "@/lib/device/feedback";
import { turnOf } from "@/lib/game/moves";
import { turnSchedule, type Gate } from "@/lib/game/turnSchedule";
import { RoundEnding } from "@/lib/theme";

/** Local response deadline. Offline there is no server, so the client enforces it. */
export const HUMAN_TURN_SECONDS = TURN_TIMEOUT_MS / 1000;

const EXCHANGE_HOLD = exchangeHold(Platform.OS);

export interface OfflineDriver {
  viewerSeat: number;
  autoPassed: number;
  /** The table has shown the received card, so a bot winner's choice follows what was seen. */
  onExchangeReady: () => void;
  onDealing: (dealing: boolean) => void;
  onRoundLanded: ((landsAt: number) => void) | undefined;
  turnTimer: { seconds: number; table: "offline"; pausable: true; onExpire: () => void };
  exchangeHold: ExchangeHold | undefined;
}

/** What the table has shown, as the flags the screen reports it by. */
export interface GatesSeen {
  dealing: boolean;
  announcing: boolean;
  received: boolean;
}

/** Whether each gate is past; a `Record` over `Gate`, so a gate added to the schedule fails to compile until it is answered here. */
const PAST: Record<Gate, (seen: GatesSeen) => boolean> = {
  deal: (seen) => !seen.dealing,
  receive: (seen) => seen.received,
  ceremony: (seen) => !seen.announcing,
  // A human's own client holds the opening notice; a bot's slot never carries it.
  opening: () => true,
};

/** Whether the table has observed every gate the schedule names. */
export function gatesPast(gates: readonly Gate[], seen: GatesSeen): boolean {
  return gates.every((gate) => PAST[gate](seen));
}

/** Null-safe, so the screen calls it before its `if (!gameState)`. */
export function useOfflineDriver(): OfflineDriver {
  const { gameState, passTurn, runBotTurn } = useLocalTable();
  const { exchangeAnnouncing } = useLocalExchange();
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
  const seatOnMove = gameState?.exchangePhase && (gameState.exchangePhase.kind === "open" || exchangeAnnouncing)
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

  // Bot turn loop. The key is the move the bot answers, and null whenever no bot is on move or a gate
  // is still up, so an update that records no move cannot restart the "thinking" timer. Each gate
  // lifts on the table's own event, never on a time computed here.
  const [dealing, setDealing] = useState(false);
  const exchangeOpen = gameState?.exchangePhase?.kind === "open";
  const [exchangeReady, setExchangeReady] = useState(false);
  if (!exchangeOpen && exchangeReady) setExchangeReady(false);
  const slot = gameState && turnSchedule(gameState, "offline", (seat) => gameState.players[seat]?.type === "bot");
  const gatesObserved = !!slot && gatesPast(slot.gates, { dealing, announcing: exchangeAnnouncing, received: exchangeReady });
  const botTurnKey = gameState && slot?.bot && gatesObserved && !e2e.suspendBot ? turnOf(gameState) : null;
  const thinkMs = E2E_FAST ? 0 : (slot?.thinkMs ?? 0);

  useEffect(() => {
    if (botTurnKey === null) return;
    // Even at zero: the table raises the deal's flag in an effect of its own, and this commit still reads it down.
    const t = setTimeout(runBotTurn, thinkMs);
    return () => clearTimeout(t);
  }, [botTurnKey, thinkMs, runBotTurn]);

  // Offline there is no server to announce the deadline expiring, so the
  // turn would simply vanish. The pass sound is the table's, fired off
  // the committed state; what is added here is the warn haptic and the
  // reason, which the table floats in place of its own pass.
  // The turn the clock was kept for: if it has moved on by the time the clock fires, nobody is passed.
  const clockTurn = gameState?.lastMove;
  const onExpire = useCallback(() => {
    if (clockTurn === undefined || !passTurn(clockTurn)) return;
    uiFeedback("warn");
    setAutoPassed((n) => n + 1);
  }, [clockTurn, passTurn]);

  const onExchangeReady = useCallback(() => setExchangeReady(true), []);

  return {
    viewerSeat,
    autoPassed,
    onExchangeReady,
    onDealing: setDealing,
    onRoundLanded: roundEnding ? setRoundLandedAt : undefined,
    // Nothing else is keeping this clock, so it can be stopped while an announcement holds the table.
    turnTimer: { seconds: HUMAN_TURN_SECONDS, table: "offline", pausable: true, onExpire },
    exchangeHold: EXCHANGE_HOLD,
  };
}
