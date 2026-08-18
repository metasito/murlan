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
import { useQueryClient } from "@tanstack/react-query";
import { getSocket } from "@/lib/socket";
import { useNotification } from "@/context/NotificationContext";
import { t, translateServerPayload, type ServerPayload } from "@/lib/i18n";
import type { Socket } from "socket.io-client";
import { MATCH_TARGETS, matchIsClosing } from "@/lib/gameEngine";
import { handCountOf } from "@/components/gameTableModel";
import { clearReactions, pushReaction } from "@/lib/reactions";
import type { GameState, MatchLength } from "@/lib/gameEngine";
import type { ExchangeAnnounceData } from "@/lib/sharedGameFlow";
import type { BotPersonalityId } from "@/lib/botPersonalities";

export interface RoomState {
  roomId: string;
  code: string;
  hostUserId: string | null;
  status: "waiting" | "in_progress" | "finished";
  gameMode: "free_for_all" | "teams";
  maxPlayers: number;
  players: Array<{ seatIndex: number; userId: string; username: string }>;
}

export interface RematchVoteState {
  votes: string[];
  total: number;
}

/** The running match, as the server reports it. */
export interface OnlineMatchState {
  target: number;
  length: MatchLength;
  over: boolean;
  /** Display names, empty until the match ends. */
  winners: string[];
  isDraw: boolean;
  /** Verdict of the rematch question once the match is over. */
  continues: boolean;
}

/** Answers to the side-panel rematch question, by userId. */
export interface RematchIntentState {
  yes: number;
  total: number;
  answers: Record<string, boolean>;
}

const INITIAL_MATCH: OnlineMatchState = {
  target: MATCH_TARGETS[0],
  length: "match",
  over: false,
  winners: [],
  isDraw: false,
  continues: false,
};

const INITIAL_INTENTS: RematchIntentState = { yes: 0, total: 0, answers: {} };

interface OnlineGameContextValue {
  room: RoomState | null;
  gameState: GameState | null;
  connected: boolean;
  error: string | null;
  playerLeft: boolean;
  rejoinFailed: boolean;
  disconnectedPlayers: Set<string>;
  reconnectNotice: string | null;
  mySeatIndex: number;
  /** The acting seat's remaining AFK window, as the server measured it. */
  turnSeconds: number;
  /** Opaque: changes whenever the server re-arms, so the clock restarts. */
  turnDeadlineMs: number | undefined;
  entrySource: "quickmatch" | "friends" | null;
  rematchVoteState: RematchVoteState | null;
  cumulativeScores: Record<string, number>;
  matchState: OnlineMatchState;
  rematchIntents: RematchIntentState;
  /** True while the table is being asked whether it wants another match. */
  rematchPromptOpen: boolean;
  exchangeAnnouncing: boolean;
  exchangeAnnounceData: ExchangeAnnounceData | null;
  createRoom: (gameMode: "free_for_all" | "teams", maxPlayers: number) => void;
  joinRoom: (code: string) => void;
  /** Watch a table without taking a seat. */
  spectateRoom: (code: string) => void;
  /** True while watching. No seat, no actions, every hand hidden. */
  isSpectator: boolean;
  leaveRoom: () => void;
  quickmatch: (maxPlayers: number, gameMode: "free_for_all" | "teams") => void;
  startGame: (opts?: {
    fillWithBots?: boolean;
    botPersonality?: BotPersonalityId;
    matchLength?: MatchLength;
  }) => void;
  requestPlayAgain: () => void;
  voteRematch: () => void;
  answerRematch: (wants: boolean) => void;
  playCards: (cardIds: string[]) => void;
  pass: () => void;
  giveExchangeCard: (cardId: string) => void;
  acknowledgeExchange: () => void;
  sendReaction: (emoji: string) => void;
  clearError: () => void;
  clearPlayerLeft: () => void;
  /**
   * Consumes the bounce back to the lobby. `rejoinFailed` stays true until the
   * screen that acts on it says so, and nothing else clears it — left latched
   * it would eject the player from the next table they open, spectated or
   * played.
   */
  clearRejoinFailed: () => void;
}

const OnlineGameContext = createContext<OnlineGameContextValue | null>(null);

// Persisted so a cold start — or leaving the (online) route group, which unmounts
// this provider — does not lock a player out of a game that is still live server-side.
const ACTIVE_ROOM_KEY = "@murlan_active_room";

// The waiting lobby's own handle, kept apart from ACTIVE_ROOM_KEY because the
// two answer different events: a waiting room has no live game, so its id would
// produce a `game:rejoin` the server can never satisfy. This one holds the room
// *code*, which is what `room:rejoin` takes.
const WAITING_ROOM_KEY = "@murlan_waiting_room";

// A SERVER_ERROR rejoin failure is the server handler's blanket catch, not a
// verdict on the table, so it is retried rather than treated as terminal. The
// cap keeps the retries well inside the server's 20-per-60s rejoin limit,
// past which the reply would be a `game:error` this path does not listen for.
const REJOIN_RETRY_DELAY_MS = 2000;
const MAX_REJOIN_RETRIES = 3;

// The `room:rejoin` rejections that mean the seat is gone for good (see the
// handler in server/socket.ts). `room:error` carries no room id, so the code is
// the only thing that separates the answer to an outstanding rejoin from an
// error about an action inside a room the player is still sitting in — and only
// the first may take the lobby down with it.
const TERMINAL_ROOM_REJOIN_CODES = new Set([
  "ROOM_NOT_FOUND",
  "NOT_IN_ROOM",
  "GAME_ALREADY_STARTED",
  "ROOM_FULL",
]);

interface TurnDeadline {
  turnDeadlineMs?: number;
  turnSecondsRemaining: number;
}

const NO_TURN_DEADLINE: TurnDeadline = { turnSecondsRemaining: 0 };

export function OnlineGameProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const { showNotification } = useNotification();
  const qc = useQueryClient();
  const [room, setRoom] = useState<RoomState | null>(null);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playerLeft, setPlayerLeft] = useState(false);
  const [entrySource, setEntrySource] = useState<"quickmatch" | "friends" | null>(null);
  const [rematchVoteState, setRematchVoteState] = useState<RematchVoteState | null>(null);
  const [cumulativeScores, setCumulativeScores] = useState<Record<string, number>>({});
  const [matchState, setMatchState] = useState<OnlineMatchState>(INITIAL_MATCH);
  const [rematchIntents, setRematchIntents] = useState<RematchIntentState>(INITIAL_INTENTS);
  const [exchangeAnnouncing, setExchangeAnnouncing] = useState(false);
  const [exchangeAnnounceData, setExchangeAnnounceData] = useState<ExchangeAnnounceData | null>(null);
  const [rejoinFailed, setRejoinFailed] = useState(false);
  const [disconnectedPlayers, setDisconnectedPlayers] = useState<Set<string>>(new Set());
  const [reconnectNotice, setReconnectNotice] = useState<string | null>(null);
  const [isSpectator, setIsSpectator] = useState(false);

  const prevExchangeActiveRef = useRef(false);
  const prevGameStateRef = useRef<GameState | null>(null);
  const prevBothJokersExceptionRef = useRef(false);
  const roomRef = useRef<RoomState | null>(null);
  const gameStateRef = useRef<GameState | null>(null);
  const reconnectNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Room id read back from storage — the only rejoin handle available after a cold start.
  const persistedRoomIdRef = useRef<string | null>(null);
  // The waiting lobby's code, same purpose for `room:rejoin`.
  const persistedWaitingCodeRef = useRef<string | null>(null);
  // The room a `room:rejoin` is in flight for. A `room:error` that answers it
  // means the seat is gone, and unlike every other room:error — which answers
  // an action taken inside a room the player still holds — the stale lobby has
  // to go with it.
  const rejoiningRoomCodeRef = useRef<string | null>(null);
  // The room id a `game:rejoin` is currently in flight for, cleared by the
  // live state that answers it. A `game:rejoin_failed` may only tear down
  // state when it names *this* room: the round-trip is async, so a failure for
  // an old room can otherwise land after the player has already moved to
  // another one and wipe that one out instead. Null means nothing is
  // outstanding, so no reply is allowed to act.
  const requestedRoomIdRef = useRef<string | null>(null);
  const rejoinRetriesRef = useRef(0);
  const rejoinRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The server now stamps every game:state with the viewer's authoritative
  // seat index (see sanitizeStateForPlayer on the server). -1 is an explicit
  // "unknown" sentinel — it must never be confused with a real seat (0..3),
  // which silently defaulting to 0 used to do.
  const [mySeatIndex, setMySeatIndex] = useState(-1);
  const [turnDeadline, setTurnDeadline] = useState<TurnDeadline>(NO_TURN_DEADLINE);

  const socket: Socket = getSocket(userId);

  const persistActiveRoom = useCallback((roomId: string | null) => {
    persistedRoomIdRef.current = roomId;
    if (roomId) {
      AsyncStorage.setItem(ACTIVE_ROOM_KEY, roomId).catch(() => {});
    } else {
      AsyncStorage.removeItem(ACTIVE_ROOM_KEY).catch(() => {});
    }
  }, []);

  const persistWaitingRoom = useCallback((code: string | null) => {
    persistedWaitingCodeRef.current = code;
    if (code) {
      AsyncStorage.setItem(WAITING_ROOM_KEY, code).catch(() => {});
    } else {
      AsyncStorage.removeItem(WAITING_ROOM_KEY).catch(() => {});
    }
  }, []);

  /** Nothing is outstanding: no reply may act, and no retry is pending. */
  const forgetRejoinAttempt = useCallback(() => {
    requestedRoomIdRef.current = null;
    rejoinRetriesRef.current = 0;
    if (rejoinRetryTimerRef.current) {
      clearTimeout(rejoinRetryTimerRef.current);
      rejoinRetryTimerRef.current = null;
    }
  }, []);

  /**
   * Asks the server for whatever this provider is still holding: a live game,
   * or a seat in a waiting lobby.
   *
   * Returns whether anything was sent. Not every state has a question to ask —
   * an in-progress room with no game state matches no branch — and a caller
   * that is waiting for a reply has to know it will never come.
   */
  const attemptRejoin = useCallback((): boolean => {
    const currentRoom = roomRef.current;
    const currentGame = gameStateRef.current;
    if (currentRoom && currentGame && !currentGame.gameOver) {
      requestedRoomIdRef.current = currentRoom.roomId;
      socket.emit("game:rejoin", { roomCode: currentRoom.roomId });
      return true;
    }
    // Cold start / remounted provider: no in-memory room, but storage may hold one.
    if (!currentRoom && persistedRoomIdRef.current) {
      requestedRoomIdRef.current = persistedRoomIdRef.current;
      socket.emit("game:rejoin", { roomCode: persistedRoomIdRef.current });
      return true;
    }

    // A waiting lobby has no game to rejoin, only a seat — and the seat was
    // released the moment the old socket dropped. `room:rejoin` takes it back
    // and re-maps the new socket to the room; without it the server resolves
    // every later room event to nothing and answers none of them.
    if (currentGame) return false;
    const waitingCode = currentRoom
      ? currentRoom.status === "waiting"
        ? currentRoom.code
        : null
      : persistedWaitingCodeRef.current;
    if (waitingCode) {
      rejoiningRoomCodeRef.current = waitingCode;
      socket.emit("room:rejoin", { code: waitingCode });
      return true;
    }
    return false;
  }, [userId]);

  /**
   * Gives up on the rejoin: the player is told why, then everything holding the
   * table open goes, which is what sends them back to the lobby. The reason is
   * shown first — the server distinguishes a vacated seat from a finished game
   * from a deploy that invalidated it, and the teardown alone reads as the
   * table simply vanishing.
   */
  const abandonRejoin = useCallback(
    (payload: ServerPayload) => {
      showNotification({
        type: "game_error",
        title: t("onlineGame.rejoinFailedTitle"),
        message: translateServerPayload(payload),
        duration: 4500,
      });
      forgetRejoinAttempt();
      persistActiveRoom(null);
      persistWaitingRoom(null);
      gameStateRef.current = null;
      setGameState(null);
      setRoom(null);
      roomRef.current = null;
      setMySeatIndex(-1);
      setPlayerLeft(false);
      setRematchVoteState(null);
      setCumulativeScores({});
      prevExchangeActiveRef.current = false;
      prevBothJokersExceptionRef.current = false;
      setDisconnectedPlayers(new Set());
      setReconnectNotice(null);
      if (reconnectNoticeTimerRef.current) clearTimeout(reconnectNoticeTimerRef.current);
      setRejoinFailed(true);
    },
    [showNotification, forgetRejoinAttempt, persistActiveRoom, persistWaitingRoom]
  );

  // Load the persisted handles, then rejoin immediately if the socket is already up.
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      AsyncStorage.getItem(ACTIVE_ROOM_KEY),
      AsyncStorage.getItem(WAITING_ROOM_KEY),
    ])
      .then(([storedRoomId, storedWaitingCode]) => {
        if (cancelled || (!storedRoomId && !storedWaitingCode)) return;
        persistedRoomIdRef.current = storedRoomId;
        persistedWaitingCodeRef.current = storedWaitingCode;
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
      forgetRejoinAttempt();
      rejoiningRoomCodeRef.current = null;
      // One handle per event, and only a live game is worth a `game:rejoin`: a
      // waiting room has no `active_games` row, so its id under ACTIVE_ROOM_KEY
      // asks the server a question it can only ever answer with a terminal
      // rejoin failure. The lobby is recovered by `room:rejoin` off its own key.
      persistActiveRoom(data.status === "in_progress" ? data.roomId : null);
      persistWaitingRoom(data.status === "waiting" ? data.code : null);
    };

    // Server payloads carry { code, params, message }; render the code in the
    // player's language and fall back to the server's Italian text if unknown.
    const onRoomError = (payload: ServerPayload) => {
      // A refused `room:rejoin` is the one room:error that answers a room the
      // player no longer holds: the lobby on screen is a roster the server has
      // already dropped them from, so it goes with the error rather than
      // leaving them waiting on a game they are not in.
      if (rejoiningRoomCodeRef.current && TERMINAL_ROOM_REJOIN_CODES.has(payload.code ?? "")) {
        rejoiningRoomCodeRef.current = null;
        persistWaitingRoom(null);
        setRoom(null);
        roomRef.current = null;
      }
      // `spectateRoom` claims the flag before the server has answered, and a
      // refusal is the only answer some attempts ever get. Left set it would
      // send `room:unspectate` for the next table the player actually sits at,
      // which releases nothing — the seat stays occupied and keeps being dealt.
      setIsSpectator(false);
      setError(translateServerPayload(payload));
    };

    const onGameState = (
      state: GameState & { viewerSeatIndex?: number | null } & Partial<TurnDeadline>
    ) => {
      forgetRejoinAttempt();
      if (typeof state.turnSecondsRemaining === "number") {
        setTurnDeadline({
          turnDeadlineMs: state.turnDeadlineMs,
          turnSecondsRemaining: state.turnSecondsRemaining,
        });
      }
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
      // A dealt table is not a lobby any more, and `room:start` broadcasts no
      // fresh room:state — this is the only thing that retires the handle.
      persistWaitingRoom(null);
    };

    const onGameError = (payload: ServerPayload) => {
      // Error is shown as an in-game toast in game.tsx (auto-clears after 3s)
      setError(translateServerPayload(payload));
    };

    const onGameNotification = (
      payload: ServerPayload & { type: string }
    ) => {
      const text = translateServerPayload(payload);
      if (payload.type === "afk") {
        showNotification({
          type: "afk",
          title: t("game.autoPassTitle"),
          message: text,
          duration: 4500,
        });
      } else {
        showNotification({
          type: "game_info",
          title: t("common.notice"),
          message: text,
          duration: 4000,
        });
      }
    };

    const onMatchState = ({ target, length, scores }: { target: number; length: MatchLength; scores: Record<string, number> }) => {
      setMatchState({ ...INITIAL_MATCH, target, length });
      setCumulativeScores(scores);
      setRematchIntents(INITIAL_INTENTS);
    };

    const onRematchIntents = (state: RematchIntentState) => setRematchIntents(state);

    const onGameOver = ({
      cumulativeScores: cs,
      matchTarget,
      matchLength,
      matchOver,
      matchWinners,
      matchContinues,
      isDraw,
    }: {
      cumulativeScores?: Record<string, number>;
      matchTarget?: number;
      matchLength?: MatchLength;
      matchOver?: boolean;
      matchWinners?: string[];
      matchContinues?: boolean;
      isDraw?: boolean;
    }) => {
      if (cs) setCumulativeScores(cs);
      setMatchState((prev) => ({
        target: matchTarget ?? prev.target,
        length: matchLength ?? prev.length,
        over: matchOver ?? false,
        winners: matchWinners ?? [],
        isDraw: isDraw ?? false,
        continues: matchContinues ?? false,
      }));
      // The stats queries are configured with `staleTime: Infinity`
      // (lib/query-client.ts), so without this the profile keeps showing
      // whatever it read on first open for the rest of the session — a player
      // finishes a game and their counters, history and achievements do not
      // move. A hand just finished, so this is exactly when they are stale.
      qc.invalidateQueries({ queryKey: ["/api/stats/me"] });
      qc.invalidateQueries({ queryKey: ["/api/stats/history"] });
      qc.invalidateQueries({ queryKey: ["/api/stats/achievements"] });
    };

    const onVoteState = (vs: RematchVoteState) => setRematchVoteState(vs);

    const onReaction = (r: { emoji: string; fromSeat: number; username: string }) =>
      pushReaction(r);

    const onPlayerLeft = () => setPlayerLeft(true);

    // A vacated seat handed to a bot — the table survives, so this is a
    // notice and nothing more. It must stay separate from game:player_left,
    // which drives the blocking "Partita interrotta" teardown and would eject
    // every remaining human from a game the server is still keeping alive.
    const onSeatBotTakeover = (
      payload: ServerPayload & { userId: string; username: string; seatIndex: number }
    ) => {
      showNotification({
        type: "game_info",
        title: t("common.notice"),
        message: translateServerPayload(payload),
        duration: 4500,
      });
    };

    const onPlayerDisconnected = (payload: ServerPayload & { userId: string }) => {
      setDisconnectedPlayers((prev) => {
        const next = new Set(prev);
        next.add(payload.userId);
        return next;
      });
      // The server sends { code, params, message }; rendering it here rather
      // than rebuilding the sentence keeps this in the player's language and
      // keeps the grace period truthful — it is configurable server-side.
      const msg = translateServerPayload(payload);
      setReconnectNotice(msg);
      if (reconnectNoticeTimerRef.current) clearTimeout(reconnectNoticeTimerRef.current);
      reconnectNoticeTimerRef.current = setTimeout(() => {
        setReconnectNotice((cur) => (cur === msg ? null : cur));
      }, 10_000);
    };

    const onPlayerReconnected = (payload: ServerPayload & { userId: string }) => {
      setDisconnectedPlayers((prev) => {
        const next = new Set(prev);
        next.delete(payload.userId);
        return next;
      });
      const msg = translateServerPayload(payload);
      setReconnectNotice(msg);
      if (reconnectNoticeTimerRef.current) clearTimeout(reconnectNoticeTimerRef.current);
      reconnectNoticeTimerRef.current = setTimeout(() => {
        setReconnectNotice((cur) => (cur === msg ? null : cur));
      }, 3_500);
    };

    const onRejoinFailed = (data: ServerPayload & { roomCode?: string }) => {
      // Act only on a reply for the room still being waited on. The server
      // echoes the requested room id verbatim at every emit site, and live
      // state for any room clears the ref — so anything that does not match
      // answers an attempt the player has already moved past.
      if (data.roomCode && data.roomCode !== requestedRoomIdRef.current) return;

      // SERVER_ERROR is the rejoin handler's blanket catch — a database blip
      // during the round-trip, not a table that has gone. Everything the next
      // attempt needs (the room, the state, the persisted id) is kept and the
      // attempt stays outstanding, so its reply is still allowed to act.
      if (data.code === "SERVER_ERROR" && rejoinRetriesRef.current < MAX_REJOIN_RETRIES) {
        rejoinRetriesRef.current += 1;
        if (rejoinRetryTimerRef.current) clearTimeout(rejoinRetryTimerRef.current);
        rejoinRetryTimerRef.current = setTimeout(() => {
          rejoinRetryTimerRef.current = null;
          // A retry that sends nothing is the end of the line, not a wait: no
          // reply is coming, the attempt would stay outstanding forever and
          // the player would sit on a table the server is not answering for.
          if (!attemptRejoin()) abandonRejoin(data);
        }, REJOIN_RETRY_DELAY_MS);
        return;
      }

      abandonRejoin(data);
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("room:state", onRoomState);
    socket.on("room:error", onRoomError);
    socket.on("game:state", onGameState);
    socket.on("game:turn_deadline", setTurnDeadline);
    socket.on("game:error", onGameError);
    socket.on("game:notification", onGameNotification);
    socket.on("game:over", onGameOver);
    socket.on("game:match_state", onMatchState);
    socket.on("game:rematch_intents", onRematchIntents);
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
      socket.off("game:turn_deadline", setTurnDeadline);
      socket.off("game:error", onGameError);
      socket.off("game:notification", onGameNotification);
      socket.off("game:over", onGameOver);
      socket.off("game:match_state", onMatchState);
      socket.off("game:rematch_intents", onRematchIntents);
      socket.off("game:vote_state", onVoteState);
      socket.off("game:reaction", onReaction);
      socket.off("game:player_left", onPlayerLeft);
      socket.off("game:seat_bot_takeover", onSeatBotTakeover);
      socket.off("game:player_disconnected", onPlayerDisconnected);
      socket.off("game:player_reconnected", onPlayerReconnected);
      socket.off("game:rejoin_failed", onRejoinFailed);
      // These timers own setState calls (and, for the rejoin retry, an emit)
      // that would otherwise fire after unmount.
      if (reconnectNoticeTimerRef.current) clearTimeout(reconnectNoticeTimerRef.current);
      if (rejoinRetryTimerRef.current) clearTimeout(rejoinRetryTimerRef.current);
      // The reaction store outlives this provider, so its contents and its
      // pending removals both have to go with the table.
      clearReactions();
    };
  }, [
    userId,
    attemptRejoin,
    abandonRejoin,
    forgetRejoinAttempt,
    persistActiveRoom,
    persistWaitingRoom,
    showNotification,
    qc,
  ]);

  const createRoom = useCallback((gameMode: "free_for_all" | "teams", maxPlayers: number) => {
    setEntrySource("friends");
    // A rejoin_failed latched by an earlier, unrelated room (e.g. a
    // force-quit from a waiting lobby) must not survive into a room the
    // player is deliberately starting fresh. The outstanding-rejoin ref is
    // left alone on purpose — it is cleared only by a reply that matches it,
    // which is what makes the stale-reply guard a guard.
    setRejoinFailed(false);
    // Taking a seat is not watching, whatever an earlier spectate attempt left
    // behind: the flag decides whether leaving this room releases the seat.
    setIsSpectator(false);
    socket.emit("room:create", { gameMode, maxPlayers });
  }, [userId]);

  const joinRoom = useCallback((code: string) => {
    setEntrySource("friends");
    setRejoinFailed(false);
    setIsSpectator(false);
    socket.emit("room:join", { code });
  }, [userId]);

  const spectateRoom = useCallback(
    (code: string) => {
      setIsSpectator(true);
      setRejoinFailed(false);
      socket.emit("room:spectate", { code: code.toUpperCase() });
    },
    [socket]
  );

  const leaveRoom = useCallback(() => {
    // A spectator never took a seat, so room:leave has nothing to release —
    // sending it anyway would run the seated teardown for a table this socket
    // does not occupy.
    if (isSpectator) {
      socket.emit("room:unspectate");
      setIsSpectator(false);
    } else {
      socket.emit("room:leave");
    }
    persistActiveRoom(null);
    // Leaving is deliberate: neither handle may bring this room back on the
    // next connect.
    persistWaitingRoom(null);
    rejoiningRoomCodeRef.current = null;
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
    forgetRejoinAttempt();
    setMySeatIndex(-1);
    prevBothJokersExceptionRef.current = false;
    prevExchangeActiveRef.current = false;
  }, [userId, isSpectator, persistActiveRoom, persistWaitingRoom, forgetRejoinAttempt]);

  const quickmatch = useCallback((maxPlayers: number, gameMode: "free_for_all" | "teams") => {
    setEntrySource("quickmatch");
    setRejoinFailed(false);
    setIsSpectator(false);
    socket.emit("room:quickmatch", { maxPlayers, gameMode });
  }, [userId]);

  const startGame = useCallback((opts?: {
    fillWithBots?: boolean;
    botPersonality?: BotPersonalityId;
    matchLength?: MatchLength;
  }) => {
    socket.emit("room:start", opts);
  }, [userId]);

  const requestPlayAgain = useCallback(() => {
    socket.emit("room:start");
  }, [userId]);

  const voteRematch = useCallback(() => {
    socket.emit("game:rematch_vote");
  }, [userId]);

  const answerRematch = useCallback((wants: boolean) => {
    socket.emit("game:rematch_intent", { wants });
  }, [userId]);

  // Same predicate as the offline table (lib/gameEngine), fed by the sanitized
  // state: opponents' hands are blanked but `handCount` is not.
  const rematchPromptOpen = useMemo(() => {
    if (!gameState || gameState.gameOver || matchState.over) return false;
    return matchIsClosing({
      length: matchState.length,
      target: matchState.target,
      cumulative: cumulativeScores,
      handCounts: gameState.players.map(handCountOf),
      playerCount: gameState.players.length,
    });
  }, [gameState, matchState, cumulativeScores]);

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
  const clearRejoinFailed = useCallback(() => setRejoinFailed(false), []);

  const contextValue = useMemo(
    () => ({
      room,
      gameState,
      connected,
      error,
      playerLeft,
      rejoinFailed,
      disconnectedPlayers,
      reconnectNotice,
      mySeatIndex,
      turnSeconds: turnDeadline.turnSecondsRemaining,
      turnDeadlineMs: turnDeadline.turnDeadlineMs,
      entrySource,
      rematchVoteState,
      cumulativeScores,
      matchState,
      rematchIntents,
      rematchPromptOpen,
      exchangeAnnouncing,
      exchangeAnnounceData,
      createRoom,
      joinRoom,
      spectateRoom,
      isSpectator,
      leaveRoom,
      quickmatch,
      startGame,
      requestPlayAgain,
      voteRematch,
      answerRematch,
      playCards,
      pass,
      giveExchangeCard,
      acknowledgeExchange,
      sendReaction,
      clearError,
      clearPlayerLeft,
      clearRejoinFailed,
    }),
    [room, gameState, connected, error, playerLeft, rejoinFailed, disconnectedPlayers, reconnectNotice, mySeatIndex, turnDeadline, entrySource, rematchVoteState, cumulativeScores, matchState, rematchIntents, rematchPromptOpen, exchangeAnnouncing, exchangeAnnounceData, createRoom, joinRoom, spectateRoom, isSpectator, leaveRoom, quickmatch, startGame, requestPlayAgain, voteRematch, answerRematch, playCards, pass, giveExchangeCard, acknowledgeExchange, sendReaction, clearError, clearPlayerLeft, clearRejoinFailed]
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
