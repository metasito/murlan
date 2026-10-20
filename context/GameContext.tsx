import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
  ReactNode,
} from "react";
import {
  GameState,
  GameMode,
  MatchLength,
  dealFirstSeatFor,
  initializeGame,
  initializeRematch,
  pickGivebackCard,
  processExchangeChoice,
  processPlay,
  processPass,
  checkPass,
  checkPlay,
} from "@/lib/game/gameEngine";
import { offlineBotMove, resolveStuckExchange } from "@/lib/game/autoMove";
import { applyRoundToMatch, freshMatch } from "@/lib/game/matchFlow";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform, Settings } from "react-native";
import { initializeOpeningAt, E2E_OPENER_KEY } from "@/lib/e2eOpener";
import { opener } from "@/lib/e2eConfig";
import { turnKey } from "@/components/flightPhysics";
import {
  OFFLINE_SAVE_KEY,
  decodeOfflineSave,
  encodeOfflineSave,
  isResumable,
  type OfflineSave,
} from "@/lib/offlineSave";
import { useNotification } from "@/context/NotificationContext";
import { t } from "@/lib/i18n";
import { exchangeAnnouncementOf, type ExchangeAnnounceData } from "@/lib/game/sharedGameFlow";
import { useExchangeAnnouncement } from "@/context/useExchangeAnnouncement";
import type { RoundResult, MatchState, PlayerSetupConfig } from "@/lib/game/matchState";

export type { PlayerSetupConfig, RoundResult, MatchState };

/** Changes only when `hasSavedGame` or `restored` flips, so a move re-renders none of its readers. */
export interface LocalSession {
  setupGame: (players: PlayerSetupConfig[], mode: GameMode, length?: MatchLength) => void;
  resetGame: () => void;
  /** A match waiting to be picked up: the live table, or the one the app was killed in. */
  hasSavedGame: boolean;
  /** Goes back to the live table, or else restores the one the app booted with. False if there was neither. */
  resumeGame: () => boolean;
  /** `gameState` is still the one `resumeGame` restored, so its last play was already thrown. */
  restored: boolean;
  /** The storage read for a match from before this launch has finished, whatever it found. */
  bootSettled: boolean;
}

/** Every command has a stable identity and reads the state the last one committed. */
export interface LocalTable {
  gameState: GameState | null;
  match: MatchState;
  exchangeAnnouncing: boolean;
  exchangeAnnounceData: ExchangeAnnounceData | null;
  playCards: (cardIds: string[]) => boolean;
  /** `expectedTurn` is the `turnKey` the caller saw; a pass for a turn that has since moved on is refused. */
  passTurn: (expectedTurn?: string) => boolean;
  runBotTurn: () => void;
  chooseExchangeCard: (cardId: string) => void;
  acknowledgeExchange: () => void;
  /** The table has shown the received card: a bot winner gives back its weakest legal card; a winner with no legal card releases the phase; a human winner waits. */
  settleExchange: () => void;
  startNextRound: () => void;
  startNewMatch: () => void;
}

type Table = { gameState: GameState | null; match: MatchState };
type Config = { players: PlayerSetupConfig[]; mode: GameMode; dealFirstSeat: number };

const SessionContext = createContext<LocalSession | null>(null);
const TableContext = createContext<LocalTable | null>(null);

export function GameProvider({ children }: { children: ReactNode }) {
  const [table, setTable] = useState<Table>(() => ({ gameState: null, match: freshMatch("match", 4) }));
  const { gameState, match } = table;
  // Assigned before the render is asked for, so a second command in the same tick reads the first one's state.
  const stateRef = useRef(table);
  const configRef = useRef<Config>({ players: [], mode: "free_for_all", dealFirstSeat: 0 });

  const [bootSave, setBootSave] = useState<OfflineSave | null>(null);
  const bootRef = useRef<OfflineSave | null>(null);
  // Once a table has been taken, set up or left, the boot read is stale: what it found was replaced.
  const bootPassed = useRef(false);
  const dropBoot = useCallback(() => {
    bootPassed.current = true;
    bootRef.current = null;
    setBootSave(null);
  }, []);

  const [bootSettled, setBootSettled] = useState(false);
  const [resumedFrom, setResumedFrom] = useState<GameState | null>(null);
  const restored = gameState !== null && gameState === resumedFrom;
  const hasSavedGame = gameState ? !match.over : isResumable(bootSave);
  const { showNotification } = useNotification();

  const {
    announcing: exchangeAnnouncing,
    data: exchangeAnnounceData,
    announce,
    end: acknowledgeExchange,
  } = useExchangeAnnouncement(gameState?.exchangePhase !== undefined);

  const write = useCallback((next: Table) => {
    stateRef.current = next;
    setTable(next);
  }, []);

  /** The only writer of engine output: a round that has just ended is scored into the match here and nowhere else. */
  const commit = useCallback(
    (next: GameState, matchBefore?: MatchState) => {
      const previous = stateRef.current.gameState;
      const match = matchBefore ?? stateRef.current.match;
      if (previous) {
        const announced = exchangeAnnouncementOf(previous, next);
        if (announced) announce(announced);
      }
      const scores = previous !== null && next.roundOver && !previous.roundOver;
      write({ gameState: next, match: scores ? applyRoundToMatch(match, next) : match });
    },
    [announce, write]
  );

  const setupGame = useCallback(
    (players: PlayerSetupConfig[], mode: GameMode, length: MatchLength = "match") => {
      // A brand-new table is always "a new match", so `matchOver` is unconditionally `true` here.
      const firstSeat = dealFirstSeatFor(true, 0, players.length);
      const viewer = Math.max(0, players.findIndex((p) => p.type === "human"));
      const state = opener(Platform.OS, () => Settings.get(E2E_OPENER_KEY))
        ? initializeOpeningAt(players, mode, firstSeat, viewer)
        : initializeGame(players, mode, firstSeat);
      configRef.current = { players, mode, dealFirstSeat: firstSeat };
      dropBoot();
      write({ gameState: state, match: freshMatch(length, players.length) });
    },
    [dropBoot, write]
  );

  /**
   * Deals the next round, seeded by the last one's order. `matchIsOver` tells `dealFirstSeatFor`
   * (`lib/game/gameEngine.ts`) whether this round starts a new match (reset to seat 0) or continues
   * the current one (rotate).
   */
  const dealNext = useCallback(
    (matchIsOver: boolean) => {
      const { gameState: previous, match } = stateRef.current;
      if (!previous?.roundOver) return;
      const { players, mode, dealFirstSeat } = configRef.current;
      const playersWithId = players.map((p, i) => ({ ...p, id: `player_${i}` }));
      const nextFirstSeat = dealFirstSeatFor(matchIsOver, dealFirstSeat, playersWithId.length);
      configRef.current = { players, mode, dealFirstSeat: nextFirstSeat };
      const state = initializeRematch(playersWithId, mode, previous.finishingOrder, nextFirstSeat);
      commit(state, matchIsOver ? freshMatch(match.length, previous.players.length) : match);
    },
    [commit]
  );

  const startNextRound = useCallback(() => dealNext(false), [dealNext]);
  const startNewMatch = useCallback(() => dealNext(true), [dealNext]);

  const chooseExchangeCard = useCallback(
    (cardId: string) => {
      const state = stateRef.current.gameState;
      if (!state?.exchangePhase?.active) return;
      commit(processExchangeChoice(state, cardId));
    },
    [commit]
  );

  const settleExchange = useCallback(() => {
    const state = stateRef.current.gameState;
    const phase = state?.exchangePhase;
    if (!state || !phase?.active) return;
    const winner = state.players[phase.winnerIdx];
    if (winner?.type === "bot") {
      const next = offlineBotMove(state);
      if (next) commit(next);
    } else if (!winner || !pickGivebackCard(winner.hand, phase.cardFromLoser?.id)) {
      commit(resolveStuckExchange(state));
    }
  }, [commit]);

  const playCards = useCallback(
    (cardIds: string[]): boolean => {
      const state = stateRef.current.gameState;
      if (!state) return false;
      const check = checkPlay(state, state.currentTurnIndex, cardIds);
      if (!check.ok) return false;
      commit(processPlay(state, check.combo));
      return true;
    },
    [commit]
  );

  const passTurn = useCallback(
    (expectedTurn?: string): boolean => {
      const state = stateRef.current.gameState;
      if (!state || !checkPass(state).ok) return false;
      if (expectedTurn !== undefined && expectedTurn !== turnKey(state)) return false;
      commit(processPass(state));
      return true;
    },
    [commit]
  );

  const runBotTurn = useCallback(() => {
    const state = stateRef.current.gameState;
    if (!state) return;
    const next = offlineBotMove(state);
    if (next) commit(next);
  }, [commit]);

  const resetGame = useCallback(() => {
    write({ gameState: null, match: freshMatch("match", stateRef.current.gameState?.players.length ?? 4) });
    dropBoot();
    AsyncStorage.removeItem(OFFLINE_SAVE_KEY).catch(() => {});
  }, [dropBoot, write]);

  const resumeGame = useCallback(() => {
    const live = stateRef.current;
    if (live.gameState && !live.match.over) {
      setResumedFrom(live.gameState);
      return true;
    }
    const save = bootRef.current;
    if (!isResumable(save)) return false;
    configRef.current = { players: save.players, mode: save.gameMode, dealFirstSeat: save.dealFirstSeat };
    dropBoot();
    setResumedFrom(save.gameState);
    write({ gameState: save.gameState, match: save.match });
    return true;
  }, [dropBoot, write]);

  // Read once, before anything can overwrite it.
  useEffect(() => {
    AsyncStorage.getItem(OFFLINE_SAVE_KEY)
      .then((raw) => {
        setBootSettled(true);
        if (bootPassed.current) return;
        const stored = decodeOfflineSave(raw);
        if (stored.kind === "incompatible") {
          AsyncStorage.removeItem(OFFLINE_SAVE_KEY).catch(() => {});
          showNotification({
            type: "game_info",
            title: t("offlineGame.saveDiscardedTitle"),
            message: t("offlineGame.saveDiscardedBody"),
          });
        }
        bootRef.current = stored.kind === "ok" ? stored.save : null;
        setBootSave(bootRef.current);
      })
      .catch(() => setBootSettled(true));
  }, [showNotification]);

  /**
   * Written on every change to anything the restore needs; the config changes only with a deal, which
   * changes `gameState` too.
   *
   * Not debounced: the online path persists to Postgres on every move, and this is a few kilobytes to
   * local storage. A write that loses a race with the next one costs a move; a debounce that loses the
   * last write before a kill costs the round, which is the thing this exists to prevent.
   */
  useEffect(() => {
    if (!gameState) return;
    if (match.over) {
      AsyncStorage.removeItem(OFFLINE_SAVE_KEY).catch(() => {});
      return;
    }
    const { players, mode, dealFirstSeat } = configRef.current;
    AsyncStorage.setItem(
      OFFLINE_SAVE_KEY,
      encodeOfflineSave({ gameState, match, players, gameMode: mode, dealFirstSeat })
    ).catch(() => {});
  }, [gameState, match]);

  const session = useMemo<LocalSession>(
    () => ({ setupGame, resetGame, hasSavedGame, resumeGame, restored, bootSettled }),
    [setupGame, resetGame, hasSavedGame, resumeGame, restored, bootSettled]
  );

  const tableValue = useMemo<LocalTable>(
    () => ({
      gameState,
      match,
      exchangeAnnouncing,
      exchangeAnnounceData,
      playCards,
      passTurn,
      runBotTurn,
      chooseExchangeCard,
      acknowledgeExchange,
      settleExchange,
      startNextRound,
      startNewMatch,
    }),
    [
      gameState,
      match,
      exchangeAnnouncing,
      exchangeAnnounceData,
      playCards,
      passTurn,
      runBotTurn,
      chooseExchangeCard,
      acknowledgeExchange,
      settleExchange,
      startNextRound,
      startNewMatch,
    ]
  );

  return (
    <SessionContext.Provider value={session}>
      <TableContext.Provider value={tableValue}>{children}</TableContext.Provider>
    </SessionContext.Provider>
  );
}

export function useGameSession(): LocalSession {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useGameSession must be used within GameProvider");
  return ctx;
}

export function useGameTable(): LocalTable {
  const ctx = useContext(TableContext);
  if (!ctx) throw new Error("useGameTable must be used within GameProvider");
  return ctx;
}
