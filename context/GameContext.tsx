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
  actingSeat,
  applyMove,
  type Move,
} from "@/lib/game/gameEngine";
import { offlineBotMove } from "@/lib/game/autoMove";
import * as flow from "@/lib/game/matchFlow";
import type { OfflineTable } from "@/lib/game/matchFlow";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform, Settings } from "react-native";
import { initializeOpeningAt, E2E_OPENER_KEY } from "@/lib/e2eOpener";
import { opener } from "@/lib/e2eConfig";
import { turnKey } from "@/components/passes";
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
  startNextRound: () => void;
  startNewMatch: () => void;
}

const NO_MATCH = flow.freshMatch("match", 4);

const SessionContext = createContext<LocalSession | null>(null);
const TableContext = createContext<LocalTable | null>(null);

export function GameProvider({ children }: { children: ReactNode }) {
  const [table, setTable] = useState<OfflineTable | null>(null);
  const gameState = table?.state ?? null;
  const match = table?.match ?? NO_MATCH;
  // Assigned before the render is asked for, so a second command in the same tick reads the first one's state.
  const stateRef = useRef(table);

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

  const write = useCallback((next: OfflineTable | null) => {
    stateRef.current = next;
    setTable(next);
  }, []);

  /** The only writer of engine output. */
  const commit = useCallback(
    (next: OfflineTable) => {
      const previous = stateRef.current?.state;
      if (previous) {
        const announced = exchangeAnnouncementOf(previous, next.state);
        if (announced) announce(announced);
      }
      write(next);
    },
    [announce, write]
  );

  const commitState = useCallback(
    (next: GameState) => {
      const live = stateRef.current;
      if (live) commit(flow.advance(live, next));
    },
    [commit]
  );

  const setupGame = useCallback(
    (players: PlayerSetupConfig[], mode: GameMode, length: MatchLength = "match") => {
      const viewer = Math.max(0, players.findIndex((p) => p.type === "human"));
      const deal = opener(Platform.OS, () => Settings.get(E2E_OPENER_KEY))
        ? initializeOpeningAt(players, mode, viewer)
        : undefined;
      dropBoot();
      write(flow.startTable(players, mode, length, { deal }));
    },
    [dropBoot, write]
  );

  const dealNext = useCallback(
    (deal: (table: OfflineTable) => OfflineTable) => {
      const live = stateRef.current;
      if (!live) return;
      const next = deal(live);
      if (next !== live) commit(next);
    },
    [commit]
  );

  const startNextRound = useCallback(() => dealNext(flow.dealNext), [dealNext]);
  const startNewMatch = startNextRound;

  const act = useCallback(
    (move: Move): boolean => {
      const state = stateRef.current?.state;
      if (!state) return false;
      const result = applyMove(state, actingSeat(state), move);
      if (result.ok) commitState(result.state);
      return result.ok;
    },
    [commitState]
  );

  const chooseExchangeCard = useCallback(
    (cardId: string) => void act({ kind: "giveback", cardId }),
    [act]
  );

  const playCards = useCallback((cardIds: string[]) => act({ kind: "play", cardIds }), [act]);

  const passTurn = useCallback(
    (expectedTurn?: string): boolean => {
      const state = stateRef.current?.state;
      if (expectedTurn !== undefined && (!state || expectedTurn !== turnKey(state))) return false;
      return act({ kind: "pass" });
    },
    [act]
  );

  const runBotTurn = useCallback(() => {
    const state = stateRef.current?.state;
    if (!state) return;
    const next = offlineBotMove(state);
    if (next) commitState(next.state);
  }, [commitState]);

  const resetGame = useCallback(() => {
    write(null);
    dropBoot();
    AsyncStorage.removeItem(OFFLINE_SAVE_KEY).catch(() => {});
  }, [dropBoot, write]);

  const resumeGame = useCallback(() => {
    const live = stateRef.current;
    if (live && !live.match.over) {
      setResumedFrom(live.state);
      return true;
    }
    const save = bootRef.current;
    if (!isResumable(save)) return false;
    dropBoot();
    setResumedFrom(save.gameState);
    write({ state: save.gameState, match: save.match, dealFirstSeat: save.dealFirstSeat });
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
   * Written on every change to anything the restore needs.
   *
   * Not debounced: the online path persists to Postgres on every move, and this is a few kilobytes to
   * local storage. A write that loses a race with the next one costs a move; a debounce that loses the
   * last write before a kill costs the round, which is the thing this exists to prevent.
   */
  useEffect(() => {
    if (!table) return;
    if (table.match.over) {
      AsyncStorage.removeItem(OFFLINE_SAVE_KEY).catch(() => {});
      return;
    }
    AsyncStorage.setItem(
      OFFLINE_SAVE_KEY,
      encodeOfflineSave({ gameState: table.state, match: table.match, dealFirstSeat: table.dealFirstSeat })
    ).catch(() => {});
  }, [table]);

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
