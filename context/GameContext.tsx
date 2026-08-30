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
  targetsFor,
  foldHandIntoMatch,
  initializeGame,
  initializeRematch,
  nextDealFirstSeat,
  isMajority,
  matchIsClosing,
  processExchangeChoice,
  processPlay,
  processPass,
  aiChoosePlay,
  opponentsOf,
  buildCombination,
  tallyRematchAnswers,
  canPlay,
} from "@/lib/gameEngine";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  OFFLINE_SAVE_KEY,
  decodeOfflineSave,
  encodeOfflineSave,
  isResumable,
} from "@/lib/offlineSave";
import { buildExchangeAnnounce, type ExchangeAnnounceData } from "@/lib/sharedGameFlow";
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
export interface MatchState {
  length: MatchLength;
  /** Current point target. Escalates 21 → 31 → 41 → 51 on a tie at the target. */
  target: number;
  /** Engine player id -> cumulative match points. */
  scores: Record<string, number>;
  hands: HandResult[];
  over: boolean;
  /** Engine player ids. Empty until the match ends. */
  winners: string[];
  isDraw: boolean;
}

/** Each seat's answer to the rematch question, by engine player id. */
export type RematchAnswers = Record<string, boolean>;

function freshMatch(length: MatchLength, playerCount: number): MatchState {
  const [target] = targetsFor(playerCount);
  if (target === undefined) throw new Error(`targetsFor(${playerCount}) returned no targets`);
  return {
    length,
    target,
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

  const [exchangeAnnouncing, setExchangeAnnouncing] = useState(false);
  const [exchangeAnnounceData, setExchangeAnnounceData] = useState<ExchangeAnnounceData | null>(null);

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
      const state = initializeGame(players, mode);
      setGameState(state);
      setSelectedCards([]);
      setDealFirstSeat(0);
      setMatch(freshMatch(length, players.length));
      setRematchAnswers({});
      setSavedPlayerConfigs(players);
      setSavedGameMode(mode);
    },
    []
  );

  /** Deals the next manche of the running match, seeded by the last one's order. */
  const dealFrom = useCallback(
    (prevRankings: string[]) => {
      const playersWithId = savedPlayerConfigs.map((p, i) => ({ ...p, id: `player_${i}` }));
      const nextFirstSeat = nextDealFirstSeat(dealFirstSeat, playersWithId.length);
      const state = initializeRematch(playersWithId, savedGameMode, prevRankings, nextFirstSeat);
      setDealFirstSeat(nextFirstSeat);

      if (state.exchangePhase?.bothJokersException) {
        setExchangeAnnounceData(buildExchangeAnnounce(state.players, state.exchangePhase));
        setExchangeAnnouncing(true);
      }

      setGameState(state);
      setSelectedCards([]);
    },
    [savedPlayerConfigs, savedGameMode, dealFirstSeat]
  );

  const startNextHand = useCallback(() => {
    if (!gameState) return;
    dealFrom(gameState.rankings);
  }, [gameState, dealFrom]);

  const startNewMatch = useCallback(() => {
    if (!gameState) return;
    setMatch(freshMatch(match.length, gameState.players.length));
    setRematchAnswers({});
    dealFrom(gameState.rankings);
  }, [gameState, match.length, dealFrom]);

  const rematchPromptOpen = useMemo(() => {
    if (!gameState || gameState.gameOver || match.over) return false;
    return matchIsClosing({
      length: match.length,
      target: match.target,
      cumulative: match.scores,
      handCounts: gameState.players.map((p) => p.hand.length),
      playerCount: gameState.players.length,
    });
  }, [gameState, match]);

  const answerRematch = useCallback((wants: boolean) => {
    const human = gameState?.players.find((p) => p.type === "human");
    if (!human) return;
    setRematchAnswers((prev) => ({ ...prev, [human.id]: wants }));
  }, [gameState]);

  const chooseExchangeCard = useCallback(
    (cardId: string) => {
      if (gameState?.exchangePhase?.active) {
        const ep = gameState.exchangePhase;
        setExchangeAnnounceData(
          buildExchangeAnnounce(gameState.players, ep, {
            given: gameState.players[ep.winnerIdx]?.hand.find((c) => c.id === cardId),
            received: ep.cardFromLoser,
          })
        );
        setExchangeAnnouncing(true);
      }
      setGameState((prev) => {
        if (!prev) return prev;
        return processExchangeChoice(prev, cardId);
      });
      setSelectedCards([]);
    },
    [gameState]
  );

  const acknowledgeExchange = useCallback(() => {
    setExchangeAnnouncing(false);
  }, []);

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
    const currentPlayer = gameState.players[gameState.currentTurnIndex];
    if (!currentPlayer || currentPlayer.type !== "ai") return;

    const isNewRound = gameState.lastPlayedCombination === null;
    const opponents = opponentsOf(gameState, gameState.currentTurnIndex);

    const requireCard = !gameState.firstPlayMade && gameState.startCard
      ? currentPlayer.hand.find((c) => c.id === gameState.startCard!.id)
      : undefined;

    const play = aiChoosePlay(
      currentPlayer,
      isNewRound ? null : gameState.lastPlayedCombination,
      isNewRound,
      opponents.handCounts,
      requireCard,
      undefined,
      opponents.partnerHoldsTop
    );

    if (play) {
      commitState(processPlay(gameState, play), gameState);
    } else if (!isNewRound) {
      const newState = processPass(gameState);
      commitState(newState, gameState);
    }
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
