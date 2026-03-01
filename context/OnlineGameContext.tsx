import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  ReactNode,
} from "react";
import { getSocket, disconnectSocket } from "@/lib/socket";
import type { GameState } from "@/lib/gameEngine";

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

interface OnlineGameContextValue {
  room: RoomState | null;
  gameState: GameState | null;
  reactions: Reaction[];
  connected: boolean;
  error: string | null;
  mySeatIndex: number;
  createRoom: (gameMode: "free_for_all" | "teams", maxPlayers: number) => void;
  joinRoom: (code: string) => void;
  leaveRoom: () => void;
  setRoomGameMode: (mode: "free_for_all" | "teams") => void;
  startGame: () => void;
  requestPlayAgain: () => void;
  playCards: (cardIds: string[]) => void;
  pass: () => void;
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
  const socketRef = useRef(getSocket(userId));

  useEffect(() => {
    const s = socketRef.current;

    s.on("connect", () => setConnected(true));
    s.on("disconnect", () => setConnected(false));

    s.on("room:state", (data: RoomState) => setRoom(data));
    s.on("room:error", ({ message }: { message: string }) => setError(message));

    s.on("game:state", (state: GameState) => setGameState(state));
    s.on("game:error", ({ message }: { message: string }) => setError(message));
    s.on("game:started", () => {});
    s.on("game:over", () => {});

    s.on("game:reaction", (r: { emoji: string; fromSeat: number; username: string }) => {
      const id = Date.now().toString() + Math.random().toString(36).substr(2, 5);
      setReactions((prev) => [...prev.slice(-9), { ...r, id }]);
      setTimeout(() => setReactions((prev) => prev.filter((x) => x.id !== id)), 2500);
    });

    s.on("game:player_left", () => setError("Un giocatore ha abbandonato la partita"));

    if (!s.connected) s.connect();

    return () => {
      s.off("connect");
      s.off("disconnect");
      s.off("room:state");
      s.off("room:error");
      s.off("game:state");
      s.off("game:error");
      s.off("game:started");
      s.off("game:over");
      s.off("game:reaction");
      s.off("game:player_left");
    };
  }, []);

  const mySeatIndex = room?.players.find((p) => p.userId === userId)?.seatIndex ?? 0;

  const createRoom = useCallback((gameMode: "free_for_all" | "teams", maxPlayers: number) => {
    socketRef.current.emit("room:create", { gameMode, maxPlayers });
  }, []);

  const joinRoom = useCallback((code: string) => {
    socketRef.current.emit("room:join", { code });
  }, []);

  const leaveRoom = useCallback(() => {
    socketRef.current.emit("room:leave");
    setRoom(null);
    setGameState(null);
  }, []);

  const setRoomGameMode = useCallback((gameMode: "free_for_all" | "teams") => {
    socketRef.current.emit("room:set_game_mode", { gameMode });
  }, []);

  const startGame = useCallback(() => {
    socketRef.current.emit("room:start");
  }, []);

  const requestPlayAgain = useCallback(() => {
    socketRef.current.emit("room:start");
  }, []);

  const playCards = useCallback((cardIds: string[]) => {
    socketRef.current.emit("game:play", { cardIds });
  }, []);

  const pass = useCallback(() => {
    socketRef.current.emit("game:pass");
  }, []);

  const sendReaction = useCallback((emoji: string) => {
    socketRef.current.emit("game:reaction", { emoji });
  }, []);

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
        createRoom,
        joinRoom,
        leaveRoom,
        setRoomGameMode,
        startGame,
        requestPlayAgain,
        playCards,
        pass,
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
