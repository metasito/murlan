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
  playerLeft: boolean;
  disconnectedPlayers: Set<string>;
  reconnectNotice: string | null;
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
  clearPlayerLeft: () => void;
}

const OnlineGameContext = createContext<OnlineGameContextValue | null>(null);

export function OnlineGameProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const [room, setRoom] = useState<RoomState | null>(null);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playerLeft, setPlayerLeft] = useState(false);
  const [entrySource, setEntrySource] = useState<"quickmatch" | "friends" | null>(null);
  const [rematchVoteState, setRematchVoteState] = useState<RematchVoteState | null>(null);
  const [cumulativeScores, setCumulativeScores] = useState<Record<string, number>>({});
  const [exchangeAnnouncing, setExchangeAnnouncing] = useState(false);
  const [exchangeAnnounceData, setExchangeAnnounceData] = useState<ExchangeAnnounceData | null>(null);
  const [disconnectedPlayers, setDisconnectedPlayers] = useState<Set<string>>(new Set());
  const [reconnectNotice, setReconnectNotice] = useState<string | null>(null);

  const prevExchangeActiveRef = useRef(false);
  const prevGameStateRef = useRef<GameState | null>(null);
  const prevBothJokersExceptionRef = useRef(false);
  const validSeatIndexRef = useRef<number | null>(null);
  const roomRef = useRef<RoomState | null>(null);
  const gameStateRef = useRef<GameState | null>(null);

  const socket: Socket = getSocket(userId);

  useEffect(() => {
    const onConnect = () => {
      setConnected(true);
      const currentRoom = roomRef.current;
      const currentGame = gameStateRef.current;
      if (currentRoom && currentGame && !currentGame.gameOver) {
        socket.emit("game:rejoin", { roomCode: currentRoom.roomId });
      }
    };
    const onDisconnect = () => setConnected(false);

    const onRoomState = (data: RoomState) => {
      roomRef.current = data;
      setRoom(data);
    };
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

      const prevBothJolly = prevBothJokersExceptionRef.current;
      const currBothJolly = state.exchangePhase?.bothJokersException ?? false;
      prevBothJokersExceptionRef.current = currBothJolly;

      if (!isActive && currBothJolly && !prevBothJolly) {
        const winnerName = state.players[state.exchangePhase!.winnerIdx]?.name ?? "";
        const loserName = state.players[state.exchangePhase!.loserIdx]?.name ?? "";
        setExchangeAnnounceData({
          winnerName,
          loserName,
          bothJokersException: true,
        });
        setExchangeAnnouncing(true);
      }

      prevGameStateRef.current = state;
      gameStateRef.current = state;
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
    const onPlayerLeft = () => setPlayerLeft(true);
    const onPlayerDisconnected = ({ userId: dcUserId, username: dcUsername }: { userId: string; username: string; message: string }) => {
      setDisconnectedPlayers((prev) => {
        const next = new Set(prev);
        next.add(dcUserId);
        return next;
      });
      setReconnectNotice(`${dcUsername} si è disconnesso. Ha 60 secondi per rientrare.`);
    };
    const onPlayerReconnected = ({ userId: rcUserId, username: rcUsername }: { userId: string; username: string }) => {
      setDisconnectedPlayers((prev) => {
        const next = new Set(prev);
        next.delete(rcUserId);
        return next;
      });
      setReconnectNotice(`${rcUsername} si è riconnesso!`);
      setTimeout(() => setReconnectNotice((cur) => cur === `${rcUsername} si è riconnesso!` ? null : cur), 3000);
    };
    const onRejoinFailed = () => {
      gameStateRef.current = null;
      setGameState(null);
      setRoom(null);
      roomRef.current = null;
      setPlayerLeft(false);
      setDisconnectedPlayers(new Set());
      setReconnectNotice(null);
      setError("Non è stato possibile rientrare nella partita.");
    };

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
    socket.on("game:player_disconnected", onPlayerDisconnected);
    socket.on("game:player_reconnected", onPlayerReconnected);
    socket.on("game:rejoin_failed", onRejoinFailed);

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
      socket.off("game:player_disconnected", onPlayerDisconnected);
      socket.off("game:player_reconnected", onPlayerReconnected);
      socket.off("game:rejoin_failed", onRejoinFailed);
    };
  }, [userId]);

  // Track the last valid seatIndex to avoid race condition fallback to 0
  const foundSeat = room?.players.find((p) => p.userId === userId)?.seatIndex;
  if (foundSeat !== undefined) {
    validSeatIndexRef.current = foundSeat;
  }
  const mySeatIndex = validSeatIndexRef.current ?? 0;

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
    roomRef.current = null;
    setGameState(null);
    gameStateRef.current = null;
    setRematchVoteState(null);
    setCumulativeScores({});
    setPlayerLeft(false);
    setDisconnectedPlayers(new Set());
    setReconnectNotice(null);
    validSeatIndexRef.current = null;
    prevBothJokersExceptionRef.current = false;
    prevExchangeActiveRef.current = false;
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
  const clearPlayerLeft = useCallback(() => setPlayerLeft(false), []);

  return (
    <OnlineGameContext.Provider
      value={{
        room,
        gameState,
        reactions,
        connected,
        error,
        playerLeft,
        disconnectedPlayers,
        reconnectNotice,
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
        clearPlayerLeft,
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
