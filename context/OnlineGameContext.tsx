import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  ReactNode,
} from "react";
import { getSocket } from "@/lib/socket";
import type { Socket } from "socket.io-client";
import type { GameState } from "@/lib/gameEngine";
import type { ExchangeAnnounceData } from "@/lib/sharedGameFlow";

export interface RoomState {
  roomId: string;
  code: string;
  hostUserId: string | null;
  status: "waiting" | "in_progress" | "finished";
  gameMode: "free_for_all" | "teams";
  maxPlayers: number;
  players: Array<{ seatIndex: number; userId: string; username: string }>;
}

export interface Reaction {
  emoji: string;
  fromSeat: number;
  username: string;
  id: string;
}

export interface RematchVoteState {
  votes: string[];
  total: number;
}

interface OnlineGameContextValue {
  room: RoomState | null;
  gameState: GameState | null;
  reactions: Reaction[];
  connected: boolean;
  error: string | null;
  mySeatIndex: number;
  entrySource: "quickmatch" | "friends" | null;
  rematchVoteState: RematchVoteState | null;
  cumulativeScores: Record<string, number>;
  exchangeAnnouncing: boolean;
  exchangeAnnounceData: ExchangeAnnounceData | null;
  createRoom: (gameMode: "free_for_all" | "teams", maxPlayers: number) => void;
  joinRoom: (code: string) => void;
  leaveRoom: () => void;
  quickmatch: (maxPlayers: number, gameMode: "free_for_all" | "teams") => void;
  setRoomGameMode: (mode: "free_for_all" | "teams") => void;
  startGame: () => void;
  requestPlayAgain: () => void;
  voteRematch: () => void;
  playCards: (cardIds: string[]) => void;
  pass: () => void;
  giveExchangeCard: (cardId: string) => void;
  acknowledgeExchange: () => void;
  sendReaction: (emoji: string) => void;
  clearError: () => void;
}

const OnlineGameContext = createContext<OnlineGameContextValue | null>(null);

export function OnlineGameProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const [room, setRoom] = useState<RoomState | null>(null);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [entrySource, setEntrySource] = useState<"quickmatch" | "friends" | null>(null);
  const [rematchVoteState, setRematchVoteState] = useState<RematchVoteState | null>(null);
  const [cumulativeScores, setCumulativeScores] = useState<Record<string, number>>({});
  const [exchangeAnnouncing, setExchangeAnnouncing] = useState(false);
  const [exchangeAnnounceData, setExchangeAnnounceData] = useState<ExchangeAnnounceData | null>(null);

  const prevExchangeActiveRef = useRef(false);
  const prevGameStateRef = useRef<GameState | null>(null);

  // Always use the singleton socket — already connected by SocketProvider
  const socket: Socket = getSocket(userId);

  useEffect(() => {
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);

    const onRoomState = (data: RoomState) => setRoom(data);
    const onRoomError = ({ message }: { message: string }) => setError(message);
    const onGameState = (state: GameState) => {
      const wasActive = prevExchangeActiveRef.current;
      const isActive = state.exchangePhase?.active === true;
      prevExchangeActiveRef.current = isActive;

      if (wasActive && !isActive && state.exchangePhase) {
        const prevPhase = prevGameStateRef.current?.exchangePhase;
        const winnerName = state.players[state.exchangePhase.winnerIdx]?.name ?? "";
        const loserName = state.players[state.exchangePhase.loserIdx]?.name ?? "";
        setExchangeAnnounceData({
          winnerName,
          loserName,
          bothJokersException: state.exchangePhase.bothJokersException,
          cardReceived: prevPhase?.cardFromLoser,
        });
        setExchangeAnnouncing(true);
      }

      if (!isActive && state.exchangePhase?.bothJokersException && !wasActive) {
        const winnerName = state.players[state.exchangePhase.winnerIdx]?.name ?? "";
        const loserName = state.players[state.exchangePhase.loserIdx]?.name ?? "";
        setExchangeAnnounceData({
          winnerName,
          loserName,
          bothJokersException: true,
        });
        setExchangeAnnouncing(true);
      }

      prevGameStateRef.current = state;
      setGameState(state);
      setRematchVoteState(null);
    };
    const onGameError = ({ message }: { message: string }) => setError(message);
    const onGameOver = ({ cumulativeScores: cs }: { cumulativeScores?: Record<string, number> }) => {
      if (cs) setCumulativeScores(cs);
    };
    const onVoteState = (vs: RematchVoteState) => setRematchVoteState(vs);
    const onReaction = (r: { emoji: string; fromSeat: number; username: string }) => {
      const id = Date.now().toString() + Math.random().toString(36).substr(2, 5);
      setReactions((prev) => [...prev.slice(-9), { ...r, id }]);
      setTimeout(() => setReactions((prev) => prev.filter((x) => x.id !== id)), 2500);
    };
    const onPlayerLeft = () => setError("Un giocatore ha abbandonato la partita");

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("room:state", onRoomState);
    socket.on("room:error", onRoomError);
    socket.on("game:state", onGameState);
    socket.on("game:error", onGameError);
    socket.on("game:started", () => {});
    socket.on("game:over", onGameOver);
    socket.on("game:vote_state", onVoteState);
    socket.on("game:reaction", onReaction);
    socket.on("game:player_left", onPlayerLeft);

    // Sync connection state immediately
    if (socket.connected) setConnected(true);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("room:state", onRoomState);
      socket.off("room:error", onRoomError);
      socket.off("game:state", onGameState);
      socket.off("game:error", onGameError);
      socket.off("game:started");
      socket.off("game:over", onGameOver);
      socket.off("game:vote_state", onVoteState);
      socket.off("game:reaction", onReaction);
      socket.off("game:player_left", onPlayerLeft);
    };
  }, [userId]);

  const mySeatIndex = room?.players.find((p) => p.userId === userId)?.seatIndex ?? 0;

  const createRoom = useCallback((gameMode: "free_for_all" | "teams", maxPlayers: number) => {
    setEntrySource("friends");
    socket.emit("room:create", { gameMode, maxPlayers });
  }, [userId]);

  const joinRoom = useCallback((code: string) => {
    setEntrySource("friends");
    socket.emit("room:join", { code });
  }, [userId]);

  const leaveRoom = useCallback(() => {
    socket.emit("room:leave");
    setRoom(null);
    setGameState(null);
    setRematchVoteState(null);
    setCumulativeScores({});
  }, [userId]);

  const quickmatch = useCallback((maxPlayers: number, gameMode: "free_for_all" | "teams") => {
    setEntrySource("quickmatch");
    socket.emit("room:quickmatch", { maxPlayers, gameMode });
  }, [userId]);

  const setRoomGameMode = useCallback((gameMode: "free_for_all" | "teams") => {
    socket.emit("room:set_game_mode", { gameMode });
  }, [userId]);

  const startGame = useCallback(() => {
    socket.emit("room:start");
  }, [userId]);

  const requestPlayAgain = useCallback(() => {
    socket.emit("room:start");
  }, [userId]);

  const voteRematch = useCallback(() => {
    socket.emit("game:rematch_vote");
  }, [userId]);

  const playCards = useCallback((cardIds: string[]) => {
    socket.emit("game:play", { cardIds });
  }, [userId]);

  const pass = useCallback(() => {
    socket.emit("game:pass");
  }, [userId]);

  const giveExchangeCard = useCallback((cardId: string) => {
    socket.emit("game:exchange_give_card", { cardId });
  }, [userId]);

  const acknowledgeExchange = useCallback(() => {
    setExchangeAnnouncing(false);
  }, []);

  const sendReaction = useCallback((emoji: string) => {
    socket.emit("game:reaction", { emoji });
  }, [userId]);

  const clearError = useCallback(() => setError(null), []);

  return (
    <OnlineGameContext.Provider
      value={{
        room,
        gameState,
        reactions,
        connected,
        error,
        mySeatIndex,
        entrySource,
        rematchVoteState,
        cumulativeScores,
        exchangeAnnouncing,
        exchangeAnnounceData,
        createRoom,
        joinRoom,
        leaveRoom,
        quickmatch,
        setRoomGameMode,
        startGame,
        requestPlayAgain,
        voteRematch,
        playCards,
        pass,
        giveExchangeCard,
        acknowledgeExchange,
        sendReaction,
        clearError,
      }}
    >
      {children}
    </OnlineGameContext.Provider>
  );
}

export function useOnlineGame() {
  const ctx = useContext(OnlineGameContext);
  if (!ctx) throw new Error("useOnlineGame must be used within OnlineGameProvider");
  return ctx;
}
