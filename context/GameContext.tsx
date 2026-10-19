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
import { realExchange } from "@/lib/e2eRealExchange";
import {
  OFFLINE_SAVE_KEY,
  decodeOfflineSave,
  encodeOfflineSave,
  isResumable,
  type OfflineSave,
} from "@/lib/offlineSave";
import { useNotification } from "@/context/NotificationContext";
import { t } from "@/lib/i18n";
import {
  exchangeAnnouncementOf,
  type ExchangeAnnounceData,
  type ExchangeHold,
} from "@/lib/game/sharedGameFlow";
import { useExchangeAnnouncement } from "@/context/useExchangeAnnouncement";
import type { RoundResult, MatchState, PlayerSetupConfig } from "@/lib/game/matchState";

// Read once at module scope, matching app/game.tsx's own E2E_FAST — inlined
// at bundle build time, so this only ever takes the fast path in a build the
// E2E harness produced itself.
const E2E_FAST = process.env.EXPO_PUBLIC_E2E_FAST === "1";
const E2E_REAL_EXCHANGE = realExchange(E2E_FAST);
// A launch argument on iOS lands in NSUserDefaults, which `Settings` reads; Android and web have no such channel.
const E2E_OPENER = E2E_FAST && Platform.OS === "ios" && String(Settings.get(E2E_OPENER_KEY)) === "1";
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

export type { PlayerSetupConfig, RoundResult, MatchState };

interface GameContextValue {
  gameState: GameState | null;
  match: MatchState;
  exchangeAnnouncing: boolean;
  exchangeAnnounceData: ExchangeAnnounceData | null;
  /** Set only under `EXPO_PUBLIC_E2E_FAST` (#915), unless a spec opted out (`lib/e2eRealExchange.ts`); undefined for a real player. */
  exchangeHoldMsOverride: ExchangeHold | undefined;
  setupGame: (players: PlayerSetupConfig[], mode: GameMode, length?: MatchLength) => void;
  startNextRound: () => void;
  startNewMatch: () => void;
  chooseExchangeCard: (cardId: string) => void;
  acknowledgeExchange: () => void;
  playCards: (cardIds: string[]) => boolean;
  passTurn: () => void;
  resetGame: () => void;
  runBotTurn: () => void;
  /** Closes an exchange nobody at the table holds a legal card for. */
  releaseStuckExchange: () => void;
  /** A match the app was killed in the middle of, waiting to be picked up. */
  hasSavedGame: boolean;
  /** Restores that match. False if there was nothing worth restoring. */
  resumeGame: () => boolean;
  /** `gameState` is still the one `resumeGame` restored, so its last play was already thrown. */
  restored: boolean;
}

const GameContext = createContext<GameContextValue | null>(null);

export function GameProvider({ children }: { children: ReactNode }) {
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [resumedFrom, setResumedFrom] = useState<GameState | null>(null);
  const restored = gameState !== null && gameState === resumedFrom;

  const [match, setMatch] = useState<MatchState>(() => freshMatch("match", 4));
  const [savedPlayerConfigs, setSavedPlayerConfigs] = useState<PlayerSetupConfig[]>([]);
  const [savedGameMode, setSavedGameMode] = useState<GameMode>("free_for_all");
  const [dealFirstSeat, setDealFirstSeat] = useState(0);

  /**
   * Whether a match interrupted by the app going away is waiting to be picked
   * up. Loaded once on mount; the home screen offers it, `resumeGame` takes it.
   */
  const [hasSavedGame, setHasSavedGame] = useState(false);
  const savedRef = useRef<OfflineSave | null>(null);
  const { showNotification } = useNotification();

  const exchangeHoldMsOverride = E2E_FAST && !E2E_REAL_EXCHANGE ? E2E_EXCHANGE_HOLD : undefined;
  const {
    announcing: exchangeAnnouncing,
    data: exchangeAnnounceData,
    announce,
    end: acknowledgeExchange,
  } = useExchangeAnnouncement(gameState?.exchangePhase !== undefined);

  /**
   * The single write path for engine output: a round that has just ended is
   * scored into the match here and nowhere else, so no screen has to
   * recompute totals and none can disagree about them.
   */
  const commitState = useCallback((next: GameState, previous: GameState) => {
    const announced = exchangeAnnouncementOf(previous, next);
    if (announced) announce(announced);
    setGameState(next);
    if (!next.roundOver || previous.roundOver) return;
    setMatch((prev) => applyRoundToMatch(prev, next));
  }, [announce]);

  const setupGame = useCallback(
    (players: PlayerSetupConfig[], mode: GameMode, length: MatchLength = "match") => {
      // A brand-new table is always "a new match", so `matchOver` is
      // unconditionally `true` here.
      const firstSeat = dealFirstSeatFor(true, 0, players.length);
      const viewer = Math.max(0, players.findIndex((p) => p.type === "human"));
      const state = E2E_OPENER
        ? initializeOpeningAt(players, mode, firstSeat, viewer)
        : initializeGame(players, mode, firstSeat);
      setGameState(state);
      setDealFirstSeat(firstSeat);
      setMatch(freshMatch(length, players.length));
      setSavedPlayerConfigs(players);
      setSavedGameMode(mode);
    },
    []
  );

  /**
   * Deals the next round, seeded by the last one's order. `matchIsOver`
   * tells `dealFirstSeatFor` (`lib/game/gameEngine.ts`) whether this round starts a
   * new match (reset to seat 0) or continues the current one (rotate).
   */
  const dealFrom = useCallback(
    (previous: GameState, matchIsOver = false) => {
      const playersWithId = savedPlayerConfigs.map((p, i) => ({ ...p, id: `player_${i}` }));
      const nextFirstSeat = dealFirstSeatFor(matchIsOver, dealFirstSeat, playersWithId.length);
      const state = initializeRematch(playersWithId, savedGameMode, previous.finishingOrder, nextFirstSeat);
      setDealFirstSeat(nextFirstSeat);
      const announced = exchangeAnnouncementOf(previous, state);
      if (announced) announce(announced);
      setGameState(state);
    },
    [savedPlayerConfigs, savedGameMode, dealFirstSeat, announce]
  );

  const startNextRound = useCallback(() => {
    if (!gameState) return;
    dealFrom(gameState);
  }, [gameState, dealFrom]);

  const startNewMatch = useCallback(() => {
    if (!gameState) return;
    setMatch(freshMatch(match.length, gameState.players.length));
    dealFrom(gameState, true);
  }, [gameState, match.length, dealFrom]);

  const chooseExchangeCard = useCallback(
    (cardId: string) => {
      if (!gameState?.exchangePhase?.active) return;
      const next = processExchangeChoice(gameState, cardId);
      const announced = exchangeAnnouncementOf(gameState, next);
      if (announced) announce(announced);
      setGameState(next);
    },
    [gameState, announce]
  );

  const playCards = useCallback((cardIds: string[]): boolean => {
    if (!gameState) return false;
    const check = checkPlay(gameState, gameState.currentTurnIndex, cardIds);
    if (!check.ok) return false;

    commitState(processPlay(gameState, check.combo), gameState);
    return true;
  }, [gameState, commitState]);

  const passTurn = useCallback(() => {
    if (!gameState) return;
    if (!checkPass(gameState).ok) return;

    const newState = processPass(gameState);
    commitState(newState, gameState);
  }, [gameState, commitState]);

  const runBotTurn = useCallback(() => {
    if (!gameState) return;
    const next = offlineBotMove(gameState);
    if (next) commitState(next, gameState);
  }, [gameState, commitState]);

  const releaseStuckExchange = useCallback(() => {
    if (!gameState?.exchangePhase?.active) return;
    commitState(resolveStuckExchange(gameState), gameState);
  }, [gameState, commitState]);

  /** The stored row alone. Safe from an effect, which the flag below is not. */
  const dropSavedRow = useCallback(() => {
    savedRef.current = null;
    AsyncStorage.removeItem(OFFLINE_SAVE_KEY).catch(() => {});
  }, []);

  const clearSavedGame = useCallback(() => {
    dropSavedRow();
    setHasSavedGame(false);
  }, [dropSavedRow]);

  const resetGame = useCallback(() => {
    setGameState(null);
    setMatch(freshMatch("match", gameState?.players.length ?? 4));
    clearSavedGame();
  }, [clearSavedGame, gameState?.players.length]);

  /** Puts an interrupted match back exactly where it was. */
  const resumeGame = useCallback(() => {
    const save = savedRef.current;
    if (!isResumable(save)) return false;
    setGameState(save.gameState);
    setResumedFrom(save.gameState);
    setMatch(save.match);
    setSavedPlayerConfigs(save.players);
    setSavedGameMode(save.gameMode);
    setDealFirstSeat(save.dealFirstSeat);
    return true;
  }, []);

  // Read once, before anything can overwrite it.
  useEffect(() => {
    AsyncStorage.getItem(OFFLINE_SAVE_KEY)
      .then((raw) => {
        const stored = decodeOfflineSave(raw);
        if (stored.kind === "incompatible") {
          AsyncStorage.removeItem(OFFLINE_SAVE_KEY).catch(() => {});
          showNotification({
            type: "game_info",
            title: t("offlineGame.saveDiscardedTitle"),
            message: t("offlineGame.saveDiscardedBody"),
          });
        }
        const save = stored.kind === "ok" ? stored.save : null;
        savedRef.current = save;
        setHasSavedGame(isResumable(save));
      })
      .catch(() => {});
  }, [showNotification]);

  /**
   * Written on every change to anything the restore needs.
   *
   * Not debounced: the online path persists to Postgres on every move, and this
   * is a few kilobytes to local storage. A write that loses a race with the
   * next one costs a move; a debounce that loses the last write before a kill
   * costs the round, which is the thing this exists to prevent.
   */
  // The flag reports the stored row, so the match ending retires both — this
  // half here because the row's removal belongs to the effect below and a flag
  // does not.
  const [flaggedForOver, setFlaggedForOver] = useState(false);
  if (match.over !== flaggedForOver) {
    setFlaggedForOver(match.over);
    if (match.over && gameState) setHasSavedGame(false);
  }

  useEffect(() => {
    if (!gameState) return;
    if (match.over) {
      dropSavedRow();
      return;
    }
    AsyncStorage.setItem(
      OFFLINE_SAVE_KEY,
      encodeOfflineSave({
        gameState,
        match,
        players: savedPlayerConfigs,
        gameMode: savedGameMode,
        dealFirstSeat,
      })
    ).catch(() => {});
  }, [gameState, match, savedPlayerConfigs, savedGameMode, dealFirstSeat, dropSavedRow]);

  const value = useMemo(
    () => ({
      gameState,
      match,
      exchangeAnnouncing,
      exchangeAnnounceData,
      exchangeHoldMsOverride,
      setupGame,
      startNextRound,
      startNewMatch,
      chooseExchangeCard,
      acknowledgeExchange,
      playCards,
      passTurn,
      resetGame,
      runBotTurn,
      releaseStuckExchange,
      hasSavedGame,
      resumeGame,
      restored,
    }),
    [
      gameState,
      match,
      exchangeAnnouncing,
      exchangeAnnounceData,
      exchangeHoldMsOverride,
      setupGame,
      startNextRound,
      startNewMatch,
      chooseExchangeCard,
      acknowledgeExchange,
      playCards,
      passTurn,
      resetGame,
      runBotTurn,
      releaseStuckExchange,
      hasSavedGame,
      resumeGame,
      restored,
    ]
  );

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}

export function useGame() {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error("useGame must be used within GameProvider");
  return ctx;
}
