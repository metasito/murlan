import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  useMemo,
  ReactNode,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getSocket } from "@/lib/socket";
import { useNotification } from "@/context/NotificationContext";
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
  rejoinFailed: boolean;
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

// Persisted so a cold start — or leaving the (online) route group, which unmounts
// this provider — does not lock a player out of a game that is still live server-side.
const ACTIVE_ROOM_KEY = "@murlan_active_room";

export function OnlineGameProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const { showNotification } = useNotification();
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
  const [rejoinFailed, setRejoinFailed] = useState(false);
  const [disconnectedPlayers, setDisconnectedPlayers] = useState<Set<string>>(new Set());
  const [reconnectNotice, setReconnectNotice] = useState<string | null>(null);

  const prevExchangeActiveRef = useRef(false);
  const prevGameStateRef = useRef<GameState | null>(null);
  const prevBothJokersExceptionRef = useRef(false);
  const roomRef = useRef<RoomState | null>(null);
  const gameStateRef = useRef<GameState | null>(null);
  const reconnectNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reactionTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  // Room id read back from storage — the only rejoin handle available after a cold start.
  const persistedRoomIdRef = useRef<string | null>(null);
  // The room id a `game:rejoin` is currently in flight for. A `game:rejoin_failed`
  // reply is only allowed to tear down state if it answers *this* attempt —
  // it can otherwise land after the user has already created/joined a
  // different room and wipe that one out instead.
  const pendingRejoinRoomIdRef = useRef<string | null>(null);
  // The server now stamps every game:state with the viewer's authoritative
  // seat index (see sanitizeStateForPlayer on the server). -1 is an explicit
  // "unknown" sentinel — it must never be confused with a real seat (0..3),
  // which silently defaulting to 0 used to do.
  const [mySeatIndex, setMySeatIndex] = useState(-1);

  const socket: Socket = getSocket(userId);

  const persistActiveRoom = useCallback((roomId: string | null) => {
    persistedRoomIdRef.current = roomId;
    if (roomId) {
      AsyncStorage.setItem(ACTIVE_ROOM_KEY, roomId).catch(() => {});
    } else {
      AsyncStorage.removeItem(ACTIVE_ROOM_KEY).catch(() => {});
    }
  }, []);

  const attemptRejoin = useCallback(() => {
    const currentRoom = roomRef.current;
    const currentGame = gameStateRef.current;
    if (currentRoom && currentGame && !currentGame.gameOver) {
      pendingRejoinRoomIdRef.current = currentRoom.roomId;
      socket.emit("game:rejoin", { roomCode: currentRoom.roomId });
      return;
    }
    // Cold start / remounted provider: no in-memory room, but storage may hold one.
    if (!currentRoom && persistedRoomIdRef.current) {
      pendingRejoinRoomIdRef.current = persistedRoomIdRef.current;
      socket.emit("game:rejoin", { roomCode: persistedRoomIdRef.current });
    }
  }, [userId]);

  // Load the persisted room id, then rejoin immediately if the socket is already up.
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(ACTIVE_ROOM_KEY)
      .then((stored) => {
        if (cancelled || !stored) return;
        persistedRoomIdRef.current = stored;
        if (socket.connected) attemptRejoin();
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [userId, attemptRejoin]);

  useEffect(() => {
    const onConnect = () => {
      setConnected(true);
      attemptRejoin();
    };
    const onDisconnect = () => setConnected(false);

    const onRoomState = (data: RoomState) => {
      roomRef.current = data;
      setRoom(data);
      pendingRejoinRoomIdRef.current = null;
      // Only a live game is worth surviving a restart for. Persisting a
      // waiting-room id too meant force-quitting from a lobby produced a
      // rejoin the server can never satisfy (waiting rooms never enter
      // active games) — that latched rejoinFailed and, later, ejected the
      // player from the next game they actually started.
      persistActiveRoom(data.status === "in_progress" ? data.roomId : null);
    };

    const onRoomError = ({ message }: { message: string }) => {
      setError(message);
    };

    const onGameState = (state: GameState & { viewerSeatIndex?: number | null }) => {
      pendingRejoinRoomIdRef.current = null;
      if (typeof state.viewerSeatIndex === "number") {
        setMySeatIndex(state.viewerSeatIndex);
      }

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

      // The game genuinely ending is the only reason to forget the room while
      // still seated; a rematch re-arms it on the next non-final state.
      if (state.gameOver) {
        persistActiveRoom(null);
      } else if (roomRef.current) {
        persistActiveRoom(roomRef.current.roomId);
      }
    };

    const onGameError = ({ message }: { message: string }) => {
      // Error is shown as an in-game toast in game.tsx (auto-clears after 3s)
      setError(message);
    };

    const onGameNotification = ({ type: notifType, message }: { type: string; message: string }) => {
      if (notifType === "afk") {
        showNotification({
          type: "afk",
          title: "Passaggio automatico",
          message,
          duration: 4500,
        });
      } else {
        showNotification({
          type: "game_info",
          title: "Avviso",
          message,
          duration: 4000,
        });
      }
    };

    const onGameOver = ({ cumulativeScores: cs }: { cumulativeScores?: Record<string, number> }) => {
      if (cs) setCumulativeScores(cs);
    };

    const onVoteState = (vs: RematchVoteState) => setRematchVoteState(vs);

    const onReaction = (r: { emoji: string; fromSeat: number; username: string }) => {
      const id = Date.now().toString() + Math.random().toString(36).substr(2, 5);
      setReactions((prev) => [...prev.slice(-9), { ...r, id }]);
      const t = setTimeout(() => {
        reactionTimersRef.current.delete(t);
        setReactions((prev) => prev.filter((x) => x.id !== id));
      }, 2500);
      reactionTimersRef.current.add(t);
    };

    const onPlayerLeft = () => setPlayerLeft(true);

    // A vacated seat handed to a bot — the table survives. This must stay
    // separate from game:player_left (which drives the blocking "Partita
    // interrotta" teardown): the server used to broadcast player_left here
    // too, ejecting every remaining human from a game it was keeping alive.
    const onSeatBotTakeover = ({ message, username: leftUsername }: { userId: string; username: string; seatIndex: number; message?: string }) => {
      showNotification({
        type: "game_info",
        title: "Avviso",
        message: message ?? `${leftUsername} ha lasciato la partita — il computer gioca al suo posto.`,
        duration: 4500,
      });
    };

    const onPlayerDisconnected = ({ userId: dcUserId, username: dcUsername }: { userId: string; username: string; message: string }) => {
      setDisconnectedPlayers((prev) => {
        const next = new Set(prev);
        next.add(dcUserId);
        return next;
      });
      const msg = `${dcUsername} si è disconnesso — 60s per rientrare`;
      setReconnectNotice(msg);
      if (reconnectNoticeTimerRef.current) clearTimeout(reconnectNoticeTimerRef.current);
      reconnectNoticeTimerRef.current = setTimeout(() => {
        setReconnectNotice((cur) => (cur === msg ? null : cur));
      }, 10_000);
    };

    const onPlayerReconnected = ({ userId: rcUserId, username: rcUsername }: { userId: string; username: string }) => {
      setDisconnectedPlayers((prev) => {
        const next = new Set(prev);
        next.delete(rcUserId);
        return next;
      });
      const msg = `${rcUsername} si è riconnesso!`;
      setReconnectNotice(msg);
      if (reconnectNoticeTimerRef.current) clearTimeout(reconnectNoticeTimerRef.current);
      reconnectNoticeTimerRef.current = setTimeout(() => {
        setReconnectNotice((cur) => (cur === msg ? null : cur));
      }, 3_500);
    };

    const onRejoinFailed = (data: { reason?: string; roomCode?: string }) => {
      // The rejoin round-trip is async, so a stale failure can land after
      // the user already created or joined a different room. Only act on a
      // reply for the attempt we're actually still waiting on — otherwise
      // this wipes the room/game state that replaced it.
      if (pendingRejoinRoomIdRef.current !== null && data.roomCode !== pendingRejoinRoomIdRef.current) {
        return;
      }
      pendingRejoinRoomIdRef.current = null;
      persistActiveRoom(null);
      gameStateRef.current = null;
      setGameState(null);
      setRoom(null);
      roomRef.current = null;
      setMySeatIndex(-1);
      setPlayerLeft(false);
      setDisconnectedPlayers(new Set());
      setReconnectNotice(null);
      if (reconnectNoticeTimerRef.current) clearTimeout(reconnectNoticeTimerRef.current);
      setRejoinFailed(true);
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("room:state", onRoomState);
    socket.on("room:error", onRoomError);
    socket.on("game:state", onGameState);
    socket.on("game:error", onGameError);
    socket.on("game:notification", onGameNotification);
    socket.on("game:started", () => {});
    socket.on("game:over", onGameOver);
    socket.on("game:vote_state", onVoteState);
    socket.on("game:reaction", onReaction);
    socket.on("game:player_left", onPlayerLeft);
    socket.on("game:seat_bot_takeover", onSeatBotTakeover);
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
      socket.off("game:notification", onGameNotification);
      socket.off("game:started");
      socket.off("game:over", onGameOver);
      socket.off("game:vote_state", onVoteState);
      socket.off("game:reaction", onReaction);
      socket.off("game:player_left", onPlayerLeft);
      socket.off("game:seat_bot_takeover", onSeatBotTakeover);
      socket.off("game:player_disconnected", onPlayerDisconnected);
      socket.off("game:player_reconnected", onPlayerReconnected);
      socket.off("game:rejoin_failed", onRejoinFailed);
      // These timers own setState calls that would otherwise fire after unmount.
      if (reconnectNoticeTimerRef.current) clearTimeout(reconnectNoticeTimerRef.current);
      reactionTimersRef.current.forEach(clearTimeout);
      reactionTimersRef.current.clear();
    };
  }, [userId, attemptRejoin, persistActiveRoom, showNotification]);

  const createRoom = useCallback((gameMode: "free_for_all" | "teams", maxPlayers: number) => {
    setEntrySource("friends");
    // A rejoin_failed latched by an earlier, unrelated room (e.g. a
    // force-quit from a waiting lobby) must not survive into a room the
    // player is deliberately starting fresh.
    pendingRejoinRoomIdRef.current = null;
    setRejoinFailed(false);
    socket.emit("room:create", { gameMode, maxPlayers });
  }, [userId]);

  const joinRoom = useCallback((code: string) => {
    setEntrySource("friends");
    pendingRejoinRoomIdRef.current = null;
    setRejoinFailed(false);
    socket.emit("room:join", { code });
  }, [userId]);

  const leaveRoom = useCallback(() => {
    socket.emit("room:leave");
    persistActiveRoom(null);
    setRoom(null);
    roomRef.current = null;
    setGameState(null);
    gameStateRef.current = null;
    setRematchVoteState(null);
    setCumulativeScores({});
    setPlayerLeft(false);
    setRejoinFailed(false);
    setDisconnectedPlayers(new Set());
    setReconnectNotice(null);
    if (reconnectNoticeTimerRef.current) clearTimeout(reconnectNoticeTimerRef.current);
    pendingRejoinRoomIdRef.current = null;
    setMySeatIndex(-1);
    prevBothJokersExceptionRef.current = false;
    prevExchangeActiveRef.current = false;
  }, [userId, persistActiveRoom]);

  const quickmatch = useCallback((maxPlayers: number, gameMode: "free_for_all" | "teams") => {
    setEntrySource("quickmatch");
    pendingRejoinRoomIdRef.current = null;
    setRejoinFailed(false);
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

  const contextValue = useMemo(
    () => ({
      room,
      gameState,
      reactions,
      connected,
      error,
      playerLeft,
      rejoinFailed,
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
    }),
    [room, gameState, reactions, connected, error, playerLeft, rejoinFailed, disconnectedPlayers, reconnectNotice, mySeatIndex, entrySource, rematchVoteState, cumulativeScores, exchangeAnnouncing, exchangeAnnounceData, createRoom, joinRoom, leaveRoom, quickmatch, setRoomGameMode, startGame, requestPlayAgain, voteRematch, playCards, pass, giveExchangeCard, acknowledgeExchange, sendReaction, clearError, clearPlayerLeft]
  );

  return (
    <OnlineGameContext.Provider value={contextValue}>
      {children}
    </OnlineGameContext.Provider>
  );
}

export function useOnlineGame() {
  const ctx = useContext(OnlineGameContext);
  if (!ctx) throw new Error("useOnlineGame must be used within OnlineGameProvider");
  return ctx;
}
