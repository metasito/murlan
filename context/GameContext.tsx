import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  useRef,
  ReactNode,
} from "react";
import {
  GameState,
  Combination,
  GameMode,
  PlayerType,
  AIDifficulty,
  initializeGame,
  initializeRematch,
  processExchangeChoice,
  processPlay,
  processPass,
  aiChoosePlay,
  buildCombination,
  sortHand,
  canPlay,
  deepCloneState,
} from "@/lib/gameEngine";
import type { ExchangeAnnounceData } from "@/lib/sharedGameFlow";

export interface PlayerSetupConfig {
  name: string;
  type: PlayerType;
  difficulty?: AIDifficulty;
  team?: "A" | "B";
}

export interface RoundResult {
  round: number;
  rankings: string[];
  pointsAwarded: Record<string, number>;
}

/**
 * Calculate points for each player given rankings and player count.
 * Formula: max(0, numPlayers - 1 - position)
 *   1st place gets (numPlayers - 1) pts, last place gets 0.
 */
export function calcRoundPoints(rankings: string[], numPlayers: number): Record<string, number> {
  const pts: Record<string, number> = {};
  rankings.forEach((name, pos) => {
    pts[name] = Math.max(0, numPlayers - 1 - pos);
  });
  return pts;
}

interface GameContextValue {
  gameState: GameState | null;
  selectedCards: string[];
  lastRoundWinner: number | null;
  totalRounds: number;
  currentRound: number;
  cumulativeScores: Record<string, number>;
  roundHistory: RoundResult[];
  exchangeAnnouncing: boolean;
  exchangeAnnounceData: ExchangeAnnounceData | null;
  setupGame: (players: PlayerSetupConfig[], mode: GameMode, rounds?: number) => void;
  setupRematch: (players: PlayerSetupConfig[], mode: GameMode, prevRankings: string[]) => void;
  startNextRound: () => void;
  chooseExchangeCard: (cardId: string) => void;
  acknowledgeExchange: () => void;
  selectCard: (cardId: string) => void;
  playSelected: () => boolean;
  passTurn: () => void;
  resetGame: () => void;
  runAITurn: () => void;
}

const GameContext = createContext<GameContextValue | null>(null);

export function GameProvider({ children }: { children: ReactNode }) {
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [selectedCards, setSelectedCards] = useState<string[]>([]);
  const [lastRoundWinner, setLastRoundWinner] = useState<number | null>(null);

  const [totalRounds, setTotalRounds] = useState(1);
  const [currentRound, setCurrentRound] = useState(1);
  const [cumulativeScores, setCumulativeScores] = useState<Record<string, number>>({});
  const [roundHistory, setRoundHistory] = useState<RoundResult[]>([]);
  const [savedPlayerConfigs, setSavedPlayerConfigs] = useState<PlayerSetupConfig[]>([]);
  const [savedGameMode, setSavedGameMode] = useState<GameMode>("free_for_all");

  const [exchangeAnnouncing, setExchangeAnnouncing] = useState(false);
  const [exchangeAnnounceData, setExchangeAnnounceData] = useState<ExchangeAnnounceData | null>(null);
  const gameStateRef = useRef<GameState | null>(null);
  gameStateRef.current = gameState;

  const setupGame = useCallback(
    (players: PlayerSetupConfig[], mode: GameMode, rounds = 1) => {
      const state = initializeGame(players, mode);
      setGameState(state);
      setSelectedCards([]);
      setLastRoundWinner(null);
      setTotalRounds(rounds);
      setCurrentRound(1);
      setCumulativeScores({});
      setRoundHistory([]);
      setSavedPlayerConfigs(players);
      setSavedGameMode(mode);
    },
    []
  );

  const setupRematch = useCallback(
    (players: PlayerSetupConfig[], mode: GameMode, prevRankings: string[]) => {
      const playersWithId = players.map((p, i) => ({ ...p, id: `player_${i}` }));
      const state = initializeRematch(playersWithId, mode, prevRankings);
      setGameState(state);
      setSelectedCards([]);
      setLastRoundWinner(null);
    },
    []
  );

  const startNextRound = useCallback(() => {
    if (!gameState) return;
    const numPlayers = gameState.players.length;
    const pointsThisRound = calcRoundPoints(gameState.rankings, numPlayers);

    const newScores = { ...cumulativeScores };
    for (const [name, pts] of Object.entries(pointsThisRound)) {
      newScores[name] = (newScores[name] ?? 0) + pts;
    }
    const newHistory: RoundResult[] = [
      ...roundHistory,
      { round: currentRound, rankings: gameState.rankings, pointsAwarded: pointsThisRound },
    ];

    setCumulativeScores(newScores);
    setRoundHistory(newHistory);
    setCurrentRound((prev) => prev + 1);

    const playersWithId = savedPlayerConfigs.map((p, i) => ({ ...p, id: `player_${i}` }));
    const state = initializeRematch(playersWithId, savedGameMode, gameState.rankings);

    if (state.exchangePhase?.bothJokersException) {
      const ep = state.exchangePhase;
      setExchangeAnnounceData({
        winnerName: state.players[ep.winnerIdx]?.name ?? "",
        loserName: state.players[ep.loserIdx]?.name ?? "",
        bothJokersException: true,
      });
      setExchangeAnnouncing(true);
    }

    setGameState(state);
    setSelectedCards([]);
    setLastRoundWinner(null);
  }, [gameState, cumulativeScores, roundHistory, currentRound, savedPlayerConfigs, savedGameMode]);

  const chooseExchangeCard = useCallback(
    (cardId: string) => {
      const gs = gameStateRef.current;
      if (gs?.exchangePhase?.active) {
        const ep = gs.exchangePhase;
        const winnerName = gs.players[ep.winnerIdx]?.name ?? "";
        const loserName = gs.players[ep.loserIdx]?.name ?? "";
        const cardReceived = ep.cardFromLoser;
        const cardGiven = gs.players[ep.winnerIdx].hand.find((c) => c.id === cardId);
        setExchangeAnnounceData({
          winnerName,
          loserName,
          bothJokersException: false,
          cardGiven,
          cardReceived,
        });
        setExchangeAnnouncing(true);
      }
      setGameState((prev) => {
        if (!prev) return prev;
        return processExchangeChoice(prev, cardId);
      });
      setSelectedCards([]);
    },
    []
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

    const newState = processPlay(gameState, combo);
    setLastRoundWinner(null);
    setGameState(newState);
    setSelectedCards([]);
    return true;
  }, [gameState, selectedCards]);

  const passTurn = useCallback(() => {
    if (!gameState) return;
    if (gameState.lastPlayedCombination === null) return;

    const newState = processPass(gameState);
    if (newState.roundWinner !== null) {
      setLastRoundWinner(newState.roundWinner);
    } else {
      setLastRoundWinner(null);
    }
    setGameState(newState);
    setSelectedCards([]);
  }, [gameState]);

  const runAITurn = useCallback(() => {
    if (!gameState) return;
    const currentPlayer = gameState.players[gameState.currentTurnIndex];
    if (currentPlayer.type !== "ai") return;

    const isNewRound = gameState.lastPlayedCombination === null;
    const otherCounts = gameState.players
      .filter((_, i) => i !== gameState.currentTurnIndex)
      .map((p) => p.hand.length);

    const requireCard = !gameState.firstPlayMade && gameState.startCard
      ? currentPlayer.hand.find((c) => c.id === gameState.startCard!.id)
      : undefined;

    const play = aiChoosePlay(
      currentPlayer,
      isNewRound ? null : gameState.lastPlayedCombination,
      isNewRound,
      otherCounts,
      requireCard
    );

    if (play) {
      const newState = processPlay(gameState, play);
      setLastRoundWinner(null);
      setGameState(newState);
    } else if (!isNewRound) {
      const newState = processPass(gameState);
      if (newState.roundWinner !== null) {
        setLastRoundWinner(newState.roundWinner);
      }
      setGameState(newState);
    } else {
      // Leading a round with no play returned: the leader may not pass, so
      // doing nothing here freezes the table. Lead the lowest card instead.
      const [lowest] = sortHand(currentPlayer.hand);
      const combo = lowest && buildCombination([lowest]);
      if (combo) {
        setLastRoundWinner(null);
        setGameState(processPlay(gameState, combo));
      }
    }
    setSelectedCards([]);
  }, [gameState]);

  const resetGame = useCallback(() => {
    setGameState(null);
    setSelectedCards([]);
    setLastRoundWinner(null);
    setTotalRounds(1);
    setCurrentRound(1);
    setCumulativeScores({});
    setRoundHistory([]);
  }, []);

  const value = useMemo(
    () => ({
      gameState,
      selectedCards,
      lastRoundWinner,
      totalRounds,
      currentRound,
      cumulativeScores,
      roundHistory,
      exchangeAnnouncing,
      exchangeAnnounceData,
      setupGame,
      setupRematch,
      startNextRound,
      chooseExchangeCard,
      acknowledgeExchange,
      selectCard,
      playSelected,
      passTurn,
      resetGame,
      runAITurn,
    }),
    [
      gameState,
      selectedCards,
      lastRoundWinner,
      totalRounds,
      currentRound,
      cumulativeScores,
      roundHistory,
      exchangeAnnouncing,
      exchangeAnnounceData,
      setupGame,
      setupRematch,
      startNextRound,
      chooseExchangeCard,
      acknowledgeExchange,
      selectCard,
      playSelected,
      passTurn,
      resetGame,
      runAITurn,
    ]
  );

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}

export function useGame() {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error("useGame must be used within GameProvider");
  return ctx;
}
