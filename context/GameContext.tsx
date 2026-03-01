import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
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
  canPlay,
  deepCloneState,
} from "@/lib/gameEngine";

export interface PlayerSetupConfig {
  name: string;
  type: PlayerType;
  difficulty?: AIDifficulty;
  team?: "A" | "B";
}

interface GameContextValue {
  gameState: GameState | null;
  selectedCards: string[];
  lastRoundWinner: number | null;
  setupGame: (players: PlayerSetupConfig[], mode: GameMode) => void;
  setupRematch: (players: PlayerSetupConfig[], mode: GameMode, prevRankings: string[]) => void;
  chooseExchangeCard: (cardId: string) => void;
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

  const setupGame = useCallback(
    (players: PlayerSetupConfig[], mode: GameMode) => {
      const state = initializeGame(players, mode);
      setGameState(state);
      setSelectedCards([]);
      setLastRoundWinner(null);
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

  const chooseExchangeCard = useCallback(
    (cardId: string) => {
      setGameState((prev) => {
        if (!prev) return prev;
        return processExchangeChoice(prev, cardId);
      });
      setSelectedCards([]);
    },
    []
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
    const cards = player.hand.filter((c) => selectedCards.includes(c.id));
    if (cards.length === 0) return false;

    const combo = buildCombination(cards);
    if (!combo) return false;

    const isNewRound = gameState.lastPlayedCombination === null;
    if (!canPlay(combo, isNewRound ? null : gameState.lastPlayedCombination))
      return false;

    // First play of the game must include the 3♠
    if (!gameState.firstPlayMade) {
      const has3Spades = combo.cards.some(
        (c) => c.rank === "3" && c.suit === "spades"
      );
      if (!has3Spades) return false;
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

    // First play must include the 3♠
    const requireCard = !gameState.firstPlayMade
      ? currentPlayer.hand.find((c) => c.rank === "3" && c.suit === "spades")
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
    } else {
      if (!isNewRound) {
        const newState = processPass(gameState);
        if (newState.roundWinner !== null) {
          setLastRoundWinner(newState.roundWinner);
        }
        setGameState(newState);
      }
    }
    setSelectedCards([]);
  }, [gameState]);

  const resetGame = useCallback(() => {
    setGameState(null);
    setSelectedCards([]);
    setLastRoundWinner(null);
  }, []);

  const value = useMemo(
    () => ({
      gameState,
      selectedCards,
      lastRoundWinner,
      setupGame,
      setupRematch,
      chooseExchangeCard,
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
      setupGame,
      setupRematch,
      chooseExchangeCard,
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
