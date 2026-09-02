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
  PlayerType,
  MatchLength,
  dealFirstSeatFor,
  firstTargetFor,
  foldHandIntoMatch,
  initializeGame,
  initializeRematch,
  isMajority,
  processExchangeChoice,
  processPlay,
  processPass,
  buildCombination,
  tallyRematchAnswers,
  canPlay,
} from "@/lib/gameEngine";
import { autoMoveForSeat, resolveStuckExchange } from "@/lib/autoMove";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  OFFLINE_SAVE_KEY,
  decodeOfflineSave,
  encodeOfflineSave,
  isResumable,
} from "@/lib/offlineSave";
import {
  buildExchangeAnnounce,
  rematchPromptOpen as isRematchPromptOpen,
  useExchangeAnnouncement,
  type ExchangeAnnounceData,
} from "@/lib/sharedGameFlow";
import { handCountOf } from "@/components/gameTableModel";
import type { MatchVerdict } from "@/lib/matchState";
import type { BotPersonalityId } from "@/lib/botPersonalities";

export interface PlayerSetupConfig {
  name: string;
  type: PlayerType;
  personality?: BotPersonalityId;
  team?: "A" | "B";
}

/** One played-out manche, keyed by engine player id (`player_0`). */
export interface HandResult {
  rankings: string[];
  pointsAwarded: Record<string, number>;
}

/**
 * The match the manches belong to. Offline mirror of the server's
 * `OnlineGameState` match fields, folded forward by the same
 * `lib/gameEngine` function, so the two modes cannot drift apart.
 */
export interface MatchState extends MatchVerdict {
  /** Engine player id -> cumulative match points. */
  scores: Record<string, number>;
  hands: HandResult[];
}

/** Each seat's answer to the rematch question, by engine player id. */
export type RematchAnswers = Record<string, boolean>;

function freshMatch(length: MatchLength, playerCount: number): MatchState {
  return {
    length,
    target: firstTargetFor(playerCount),
    scores: {},
    hands: [],
    over: false,
    winners: [],
    isDraw: false,
  };
}

/**
 * `foldHandIntoMatch` in the offline shape: every seat scores under its own
 * engine player id, and none of them is a vacated seat, so no key is excluded.
 */
export function applyHandToMatch(match: MatchState, finished: GameState): MatchState {
  const teamOf: Record<string, string> = {};
  for (const p of finished.players) {
    if (p.team) teamOf[p.id] = p.team;
  }

  const folded = foldHandIntoMatch({
    rankings: finished.rankings,
    playerCount: finished.players.length,
    length: match.length,
    gameMode: finished.gameMode,
    target: match.target,
    cumulative: match.scores,
    keyOf: (engineId) => engineId,
    teamOf,
  });

  return {
    ...match,
    scores: folded.cumulative,
    hands: [...match.hands, { rankings: finished.rankings, pointsAwarded: folded.handByKey }],
    target: folded.target,
    over: folded.over,
    winners: folded.winners,
    isDraw: folded.isDraw,
  };
}

interface GameContextValue {
  gameState: GameState | null;
  selectedCards: string[];
  match: MatchState;
  rematchAnswers: RematchAnswers;
  /** True while the table is being asked whether it wants another match. */
  rematchPromptOpen: boolean;
  /** How many seats said yes, out of how many had anyone to answer. */
  rematchTally: { yes: number; total: number };
  /** True once a majority of the table has said yes to another match. */
  tableWantsRematch: boolean;
  exchangeAnnouncing: boolean;
  exchangeAnnounceData: ExchangeAnnounceData | null;
  setupGame: (players: PlayerSetupConfig[], mode: GameMode, length?: MatchLength) => void;
  startNextHand: () => void;
  startNewMatch: () => void;
  answerRematch: (wants: boolean) => void;
  chooseExchangeCard: (cardId: string) => void;
  acknowledgeExchange: () => void;
  selectCard: (cardId: string) => void;
  playSelected: () => boolean;
  passTurn: () => void;
  resetGame: () => void;
  runAITurn: () => void;
  /** Closes an exchange nobody at the table holds a legal card for. */
  releaseStuckExchange: () => void;
  /** A match the app was killed in the middle of, waiting to be picked up. */
  hasSavedGame: boolean;
  /** Restores that match. False if there was nothing worth restoring. */
  resumeGame: () => boolean;
}

const GameContext = createContext<GameContextValue | null>(null);

export function GameProvider({ children }: { children: ReactNode }) {
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [selectedCards, setSelectedCards] = useState<string[]>([]);

  const [match, setMatch] = useState<MatchState>(() => freshMatch("match", 4));
  const [rematchAnswers, setRematchAnswers] = useState<RematchAnswers>({});
  const [savedPlayerConfigs, setSavedPlayerConfigs] = useState<PlayerSetupConfig[]>([]);
  const [savedGameMode, setSavedGameMode] = useState<GameMode>("free_for_all");
  const [dealFirstSeat, setDealFirstSeat] = useState(0);

  /**
   * Whether a match interrupted by the app going away is waiting to be picked
   * up. Loaded once on mount; the home screen offers it, `resumeGame` takes it.
   */
  const [hasSavedGame, setHasSavedGame] = useState(false);
  const savedRef = useRef<ReturnType<typeof decodeOfflineSave>>(null);

  const {
    announcing: exchangeAnnouncing,
    data: exchangeAnnounceData,
    announce,
    end: acknowledgeExchange,
  } = useExchangeAnnouncement();

  /**
   * The single write path for engine output: a manche that has just ended is
   * scored into the match here and nowhere else, so no screen has to
   * recompute totals and none can disagree about them.
   */
  const commitState = useCallback((next: GameState, previous: GameState) => {
    setGameState(next);
    if (!next.gameOver || previous.gameOver) return;
    setMatch((prev) => applyHandToMatch(prev, next));
  }, []);

  const setupGame = useCallback(
    (players: PlayerSetupConfig[], mode: GameMode, length: MatchLength = "match") => {
      // A brand-new table is always "a new match", so `dealFirstSeatFor`'s
      // `matchOver` is unconditionally `true` here — routed through it anyway
      // rather than a bare `0`, so it and `dealFrom` below share the one
      // function that decides this (#803), the same as
      // `server/tableHandlers.ts`'s `startMatchAction` and `dealVotedManche`.
      const firstSeat = dealFirstSeatFor(true, 0, players.length);
      const state = initializeGame(players, mode, firstSeat);
      setGameState(state);
      setSelectedCards([]);
      setDealFirstSeat(firstSeat);
      setMatch(freshMatch(length, players.length));
      setRematchAnswers({});
      setSavedPlayerConfigs(players);
      setSavedGameMode(mode);
    },
    []
  );

  /**
   * Deals the next manche, seeded by the last one's order. `matchIsOver` is
   * `startNewMatch`'s: `dealFirstSeatFor` (`lib/gameEngine.ts`) resets a *new*
   * match to seat 0 and only rotates *within* one — the same distinction
   * `server/tableHandlers.ts`'s `startMatchAction` vs `dealVotedManche` makes
   * online — so a plain `dealFrom` call cannot carry a finished match's own
   * rotation into the new one (#803).
   */
  const dealFrom = useCallback(
    (prevRankings: string[], matchIsOver = false) => {
      const playersWithId = savedPlayerConfigs.map((p, i) => ({ ...p, id: `player_${i}` }));
      const nextFirstSeat = dealFirstSeatFor(matchIsOver, dealFirstSeat, playersWithId.length);
      const state = initializeRematch(playersWithId, savedGameMode, prevRankings, nextFirstSeat);
      setDealFirstSeat(nextFirstSeat);

      if (state.exchangePhase?.bothJokersException) {
        announce(buildExchangeAnnounce(state.players, state.exchangePhase));
      }

      setGameState(state);
      setSelectedCards([]);
    },
    [savedPlayerConfigs, savedGameMode, dealFirstSeat, announce]
  );

  const startNextHand = useCallback(() => {
    if (!gameState) return;
    dealFrom(gameState.rankings);
  }, [gameState, dealFrom]);

  const startNewMatch = useCallback(() => {
    if (!gameState) return;
    setMatch(freshMatch(match.length, gameState.players.length));
    setRematchAnswers({});
    dealFrom(gameState.rankings, true);
  }, [gameState, match.length, dealFrom]);

  const rematchPromptOpen = useMemo(
    () =>
      isRematchPromptOpen(
        gameState && {
          gameOver: gameState.gameOver,
          handCounts: gameState.players.map(handCountOf),
        },
        match,
        match.scores
      ),
    [gameState, match]
  );

  const answerRematch = useCallback((wants: boolean) => {
    const human = gameState?.players.find((p) => p.type === "human");
    if (!human) return;
    setRematchAnswers((prev) => ({ ...prev, [human.id]: wants }));
  }, [gameState]);

  const chooseExchangeCard = useCallback(
    (cardId: string) => {
      if (gameState?.exchangePhase?.active) {
        const ep = gameState.exchangePhase;
        announce(
          buildExchangeAnnounce(gameState.players, ep, {
            given: gameState.players[ep.winnerIdx]?.hand.find((c) => c.id === cardId),
            received: ep.cardFromLoser,
          })
        );
      }
      setGameState((prev) => {
        if (!prev) return prev;
        return processExchangeChoice(prev, cardId);
      });
      setSelectedCards([]);
    },
    [gameState, announce]
  );

  const selectCard = useCallback(
    (cardId: string) => {
      setSelectedCards((prev) => {
        if (prev.includes(cardId)) {
          return prev.filter((id) => id !== cardId);
        }
        return [...prev, cardId];
      });
    },
    []
  );

  const playSelected = useCallback((): boolean => {
    if (!gameState) return false;
    const player = gameState.players[gameState.currentTurnIndex];
    if (!player) return false;
    const cards = player.hand.filter((c) => selectedCards.includes(c.id));
    if (cards.length === 0) return false;

    const combo = buildCombination(cards);
    if (!combo) return false;

    const isNewRound = gameState.lastPlayedCombination === null;
    if (!canPlay(combo, isNewRound ? null : gameState.lastPlayedCombination))
      return false;

    if (!gameState.firstPlayMade && gameState.startCard) {
      const hasStartCard = combo.cards.some(
        (c) => c.id === gameState.startCard!.id
      );
      if (!hasStartCard) return false;
    }

    commitState(processPlay(gameState, combo), gameState);
    setSelectedCards([]);
    return true;
  }, [gameState, selectedCards, commitState]);

  const passTurn = useCallback(() => {
    if (!gameState) return;
    if (gameState.lastPlayedCombination === null) return;

    const newState = processPass(gameState);
    commitState(newState, gameState);
    setSelectedCards([]);
  }, [gameState, commitState]);

  const runAITurn = useCallback(() => {
    if (!gameState) return;
    const seat = gameState.currentTurnIndex;
    if (gameState.players[seat]?.type !== "ai") return;
    const next = autoMoveForSeat(gameState, seat, true, {});
    if (next) commitState(next, gameState);
  }, [gameState, commitState]);

  const releaseStuckExchange = useCallback(() => {
    if (!gameState?.exchangePhase?.active) return;
    commitState(resolveStuckExchange(gameState), gameState);
  }, [gameState, commitState]);

  const clearSavedGame = useCallback(() => {
    savedRef.current = null;
    setHasSavedGame(false);
    AsyncStorage.removeItem(OFFLINE_SAVE_KEY).catch(() => {});
  }, []);

  const resetGame = useCallback(() => {
    setGameState(null);
    setSelectedCards([]);
    setMatch(freshMatch("match", gameState?.players.length ?? 4));
    setRematchAnswers({});
    clearSavedGame();
  }, [clearSavedGame, gameState?.players.length]);

  /** Puts an interrupted match back exactly where it was. */
  const resumeGame = useCallback(() => {
    const save = savedRef.current;
    if (!isResumable(save)) return false;
    setGameState(save.gameState);
    setMatch(save.match);
    setRematchAnswers(save.rematchAnswers);
    setSavedPlayerConfigs(save.players);
    setSavedGameMode(save.gameMode);
    setDealFirstSeat(save.dealFirstSeat);
    setSelectedCards([]);
    return true;
  }, []);

  // Read once, before anything can overwrite it.
  useEffect(() => {
    AsyncStorage.getItem(OFFLINE_SAVE_KEY)
      .then((raw) => {
        const save = decodeOfflineSave(raw);
        savedRef.current = save;
        setHasSavedGame(isResumable(save));
      })
      .catch(() => {});
  }, []);

  /**
   * Written on every change to anything the restore needs.
   *
   * Not debounced: the online path persists to Postgres on every move, and this
   * is a few kilobytes to local storage. A write that loses a race with the
   * next one costs a move; a debounce that loses the last write before a kill
   * costs the hand, which is the thing this exists to prevent.
   */
  useEffect(() => {
    if (!gameState) return;
    if (match.over) {
      clearSavedGame();
      return;
    }
    AsyncStorage.setItem(
      OFFLINE_SAVE_KEY,
      encodeOfflineSave({
        gameState,
        match,
        rematchAnswers,
        players: savedPlayerConfigs,
        gameMode: savedGameMode,
        dealFirstSeat,
      })
    ).catch(() => {});
  }, [gameState, match, rematchAnswers, savedPlayerConfigs, savedGameMode, dealFirstSeat, clearSavedGame]);

  // A computer has no preference worth recording, so an AI seat abstains from
  // the count and the total alike — the same policy the server applies to bot
  // and vacated seats (docs/BRIEF.md §3.1).
  const rematchTally = useMemo(() => {
    const players = gameState?.players ?? [];
    return tallyRematchAnswers(players.length, (seat) => {
      const p = players[seat];
      return !p || p.type === "ai" ? "abstain" : rematchAnswers[p.id] === true;
    });
  }, [gameState?.players, rematchAnswers]);

  const tableWantsRematch = isMajority(rematchTally.yes, rematchTally.total);

  const value = useMemo(
    () => ({
      gameState,
      selectedCards,
      match,
      rematchAnswers,
      rematchPromptOpen,
      rematchTally,
      tableWantsRematch,
      exchangeAnnouncing,
      exchangeAnnounceData,
      setupGame,
      startNextHand,
      startNewMatch,
      answerRematch,
      chooseExchangeCard,
      acknowledgeExchange,
      selectCard,
      playSelected,
      passTurn,
      resetGame,
      runAITurn,
      releaseStuckExchange,
      hasSavedGame,
      resumeGame,
    }),
    [
      gameState,
      selectedCards,
      match,
      rematchAnswers,
      rematchPromptOpen,
      rematchTally,
      tableWantsRematch,
      exchangeAnnouncing,
      exchangeAnnounceData,
      setupGame,
      startNextHand,
      startNewMatch,
      answerRematch,
      chooseExchangeCard,
      acknowledgeExchange,
      selectCard,
      playSelected,
      passTurn,
      resetGame,
      runAITurn,
      releaseStuckExchange,
      hasSavedGame,
      resumeGame,
    ]
  );

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}

export function useGame() {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error("useGame must be used within GameProvider");
  return ctx;
}
