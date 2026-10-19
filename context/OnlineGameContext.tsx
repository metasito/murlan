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
import { useQueryClient } from "@tanstack/react-query";
import { useSocketConnection } from "@/context/SocketContext";
import { useNotification } from "@/context/NotificationContext";
import { t, translateServerPayload, useTranslation, type ServerPayload } from "@/lib/i18n";
import { Reading } from "@/lib/theme";
import { send, undelivered, type IntentEvent } from "@/lib/sendIntent";
import { MATCH_TARGETS } from "@/lib/game/gameEngine";
import {
  roundOverSchema,
  gameStateSchema,
  type IntentPayload,
  roomStateSchema,
  type WireGameState,
  type WireRoomState,
} from "@/shared/protocol";
import { requireUpdate } from "@/lib/updateRequired";
import { reportError } from "@/lib/errorReporting";
import type { EntrySource } from "@/context/onlineRouting";
import { clearReactions, pushReaction } from "@/lib/reactions";
import { joinCode } from "@/lib/deepLink";
import { handlesFor } from "@/lib/tableHandles";
import { useRejoin } from "@/context/useRejoin";
import type { MatchLength } from "@/lib/game/gameEngine";
import type { RoundOverPayload, MatchVerdict, RatingAfter } from "@/lib/game/matchState";
import {
  exchangeAnnouncementOf,
  type ExchangeAnnounceData,
} from "@/lib/game/sharedGameFlow";
import { useExchangeAnnouncement } from "@/context/useExchangeAnnouncement";
import type { BotPersonalityId } from "@/lib/game/botPersonalities";
import { LADDER_KEY } from "@/lib/ladderQuery";
import { useOwnLink } from "@/lib/useOwnLink";
import { linkPill, type LinkPill, type OwnLink } from "@/lib/ownLink";

export type RoomState = WireRoomState;

export interface RematchVoteState {
  votes: string[];
  total: number;
  deadlineMs?: number;
  secondsRemaining?: number;
}

/** The running match, as the server reports it. */
export interface OnlineMatchState extends MatchVerdict {
  /** Rounds decided on this match so far. */
  roundsPlayed: number;
  /** Once the match is over, whether a rematch may follow: false when it closed unscored, by vote or voided. */
  continues: boolean;
}

const initialTarget = MATCH_TARGETS[0];
if (initialTarget === undefined) throw new Error("MATCH_TARGETS must not be empty");

const INITIAL_MATCH: OnlineMatchState = {
  target: initialTarget,
  length: "match",
  roundsPlayed: 0,
  over: false,
  winners: [],
  isDraw: false,
  continues: false,
};

/** Another seat dropping (`back: false`) or returning; worded where it is shown. */
export type ReconnectNotice = { payload: ServerPayload; back: boolean };

/**
 * A server refusal, and the surface it answered: the table once dealt, else the room once held, else
 * the lobby. `seq` is new per event, so the same words arriving twice are two changes.
 */
export type ServerNotice = { payload: ServerPayload; seq: number; surface: "lobby" | "room" | "table" };

/** A refusal as one surface shows it, in the language on screen. */
export type ServerError = { text: string; seq: number };

interface OnlineGameContextValue {
  room: RoomState | null;
  gameState: WireGameState | null;
  connected: boolean;
  error: ServerNotice | null;
  playerLeft: boolean;
  rejoinFailed: boolean;
  reconnectNotice: ReconnectNotice | null;
  mySeatIndex: number;
  /** The acting seat's remaining AFK window, as the server measured it. */
  turnSeconds: number;
  /** Opaque: changes whenever the server re-arms, so the clock restarts. */
  turnDeadlineMs: number | undefined;
  entrySource: EntrySource;
  rematchVoteState: RematchVoteState | null;
  /** Votes to end the match outright, once a seat has been vacated. */
  endMatchVoteState: RematchVoteState | null;
  /** Seats mid disconnect grace, by seat — the countdown for the whole 60 s window. */
  disconnectedSeats: Record<number, { seconds: number; resetKey: string }>;
  /** How many times the server has passed the viewer's turn for them. */
  autoPassed: number;
  cumulativeScores: Record<string, number>;
  /** What the round just played awarded, by engine player id. */
  placementPoints: Record<string, number>;
  /** Whether `game:round_over` has scored the round `gameState` shows: its `game:state` arrives first. */
  placementPointsCurrent: boolean;
  /** What the round just played did to each seat's rating, by user id. Empty when the round rated nobody. */
  ratingDeltas: Record<string, number>;
  /** Whether the round just played wrote a `/api/stats/history` row — a bot-majority table writes none. */
  roundRecorded: boolean;
  /** Each rated seat's standing after the round just played, by user id; empty when it rated nobody. */
  ratingsAfter: Record<string, RatingAfter>;
  matchState: OnlineMatchState;
  exchangeAnnouncing: boolean;
  exchangeAnnounceData: ExchangeAnnounceData | null;
  createRoom: (gameMode: "free_for_all" | "teams", maxPlayers: number) => void;
  joinRoom: (code: string) => void;
  /** Watch a table without taking a seat. */
  spectateRoom: (code: string) => void;
  /** True while watching. No seat, no actions, every hand hidden. */
  isSpectator: boolean;
  /** Whether a table's state has arrived: `gameState !== null`, without waking on every move. */
  hasGame: boolean;
  leaveRoom: () => void;
  quickmatch: (maxPlayers: number, gameMode: "free_for_all" | "teams") => void;
  /** Host-only: whether the matcher may seat strangers into the empty seats. */
  setRoomVisibility: (visibility: "public" | "private") => void;
  startGame: (opts?: {
    fillWithBots?: boolean;
    botPersonality?: BotPersonalityId;
    matchLength?: MatchLength;
  }) => void;
  voteRematch: () => void;
  /**
   * Vote to end the match outright, or withdraw that vote — offered only
   * once a seat has been vacated.
   */
  voteToEndMatch: (wants: boolean) => void;
  playCards: (cardIds: string[]) => void;
  pass: () => void;
  giveExchangeCard: (cardId: string) => void;
  acknowledgeExchange: () => void;
  sendReaction: (emoji: string) => void;
  /** Clears the standing refusal only while it is still the one numbered `seq`. */
  clearError: (seq: number) => void;
  clearPlayerLeft: () => void;
  /**
   * Consumes the bounce back to the lobby. `rejoinFailed` stays true until the
   * screen that acts on it says so, and nothing else clears it — left latched
   * it would eject the player from the next table they open, spectated or
   * played.
   */
  clearRejoinFailed: () => void;
  /** Drops whatever backoff the socket is in and connects now; the `connect` handler rejoins as on any reconnect. */
  retryConnection: () => void;
  /** The viewer's own link as the table shows it (`lib/ownLink.ts`). */
  ownLink: OwnLink;
  /** What the connection pill says, the viewer's own link outranking another seat's return. */
  pill: LinkPill | null;
}

/**
 * One context per slice, so a field change wakes only the screens reading that
 * slice. The turn clock is what makes that worth having: `armTurn` re-arms it
 * after every state change, every rejoin and every disconnect, and every online
 * screen the router holds mounted reads one of these contexts.
 *
 * `Pick` rather than six hand-written interfaces: the field names stay declared
 * once, and a field added to the surface has to be placed in a slice to be
 * reachable (`tests/ui-rules/contextSlices.test.ts`).
 */
type ConnectionSlice = Pick<
  OnlineGameContextValue,
  | "connected"
  | "error"
  | "reconnectNotice"
  | "playerLeft"
  | "rejoinFailed"
  | "clearError"
  | "clearPlayerLeft"
  | "clearRejoinFailed"
  | "retryConnection"
  | "ownLink"
  | "pill"
>;
type RoomSlice = Pick<
  OnlineGameContextValue,
  | "room"
  | "entrySource"
  | "isSpectator"
  | "hasGame"
  | "createRoom"
  | "joinRoom"
  | "spectateRoom"
  | "leaveRoom"
  | "quickmatch"
  | "setRoomVisibility"
  | "startGame"
>;
type TableSlice = Pick<
  OnlineGameContextValue,
  "gameState" | "mySeatIndex" | "playCards" | "pass" | "sendReaction" | "disconnectedSeats" | "autoPassed"
>;
type TurnClockSlice = Pick<OnlineGameContextValue, "turnSeconds" | "turnDeadlineMs">;
type MatchSlice = Pick<
  OnlineGameContextValue,
  | "matchState"
  | "cumulativeScores"
  | "placementPoints"
  | "placementPointsCurrent"
  | "ratingDeltas"
  | "roundRecorded"
  | "ratingsAfter"
  | "rematchVoteState"
  | "endMatchVoteState"
  | "voteRematch"
  | "voteToEndMatch"
>;
type ExchangeSlice = Pick<
  OnlineGameContextValue,
  "exchangeAnnouncing" | "exchangeAnnounceData" | "giveExchangeCard" | "acknowledgeExchange"
>;

function sliceContext<T>(hookName: string) {
  const Context = createContext<T | null>(null);
  function useSlice(): T {
    const value = useContext(Context);
    if (!value) throw new Error(`${hookName} must be used within OnlineGameProvider`);
    return value;
  }
  return [Context, useSlice] as const;
}

const [ConnectionContext, useOnlineConnection] = sliceContext<ConnectionSlice>("useOnlineConnection");
const [RoomContext, useOnlineRoom] = sliceContext<RoomSlice>("useOnlineRoom");
const [TableContext, useOnlineTable] = sliceContext<TableSlice>("useOnlineTable");
const [TurnClockContext, useOnlineTurnClock] = sliceContext<TurnClockSlice>("useOnlineTurnClock");
const [MatchContext, useOnlineMatch] = sliceContext<MatchSlice>("useOnlineMatch");
const [ExchangeContext, useOnlineExchange] = sliceContext<ExchangeSlice>("useOnlineExchange");

export {
  useOnlineConnection,
  useOnlineRoom,
  useOnlineTable,
  useOnlineTurnClock,
  useOnlineMatch,
  useOnlineExchange,
};

/** The standing refusal if it answered `surface`, worded at render so a language switch reaches it. */
export function useServerError(surface: ServerNotice["surface"]): ServerError | null {
  const { error } = useOnlineConnection();
  const { translateServerPayload: translate } = useTranslation();
  return useMemo(
    () => (error?.surface === surface ? { text: translate(error.payload), seq: error.seq } : null),
    [error, surface, translate]
  );
}

export interface TurnDeadline {
  turnDeadlineMs?: number;
  turnSecondsRemaining: number;
}

const NO_TURN_DEADLINE: TurnDeadline = { turnSecondsRemaining: 0 };

export function OnlineGameProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const { showNotification, notifyError } = useNotification();
  const qc = useQueryClient();
  const [room, setRoom] = useState<RoomState | null>(null);
  const [gameState, setGameState] = useState<WireGameState | null>(null);
  const [error, setError] = useState<ServerNotice | null>(null);
  const errorSeqRef = useRef(0);
  const [playerLeft, setPlayerLeft] = useState(false);
  const [entrySource, setEntrySource] = useState<EntrySource>(null);
  const [rematchVoteState, setRematchVoteState] = useState<RematchVoteState | null>(null);
  const [endMatchVoteState, setEndMatchVoteState] = useState<RematchVoteState | null>(null);
  /** Seats mid disconnect grace, by seat — the countdown for the whole 60 s window. */
  const [disconnectedSeats, setDisconnectedSeats] = useState<
    Record<number, { seconds: number; resetKey: string }>
  >({});
  const [autoPassed, setAutoPassed] = useState(0);
  const [cumulativeScores, setCumulativeScores] = useState<Record<string, number>>({});
  const [placementPoints, setPlacementPoints] = useState<Record<string, number>>({});
  const [placementPointsCurrent, setPlacementPointsCurrent] = useState(false);
  /** What the round just played did to each seat's ladder rating, by user id. */
  const [ratingDeltas, setRatingDeltas] = useState<Record<string, number>>({});
  const [roundRecorded, setRoundRecorded] = useState(false);
  const [ratingsAfter, setRatingsAfter] = useState<Record<string, RatingAfter>>({});
  const [matchState, setMatchState] = useState<OnlineMatchState>(INITIAL_MATCH);
  const [rejoinFailed, setRejoinFailed] = useState(false);

  const {
    announcing: exchangeAnnouncing,
    data: exchangeAnnounceData,
    announce,
    end: acknowledgeExchange,
  } = useExchangeAnnouncement(gameState?.exchangePhase !== undefined);
  const [reconnectNotice, setReconnectNotice] = useState<ReconnectNotice | null>(null);
  const [isSpectator, setIsSpectator] = useState(false);

  const roomRef = useRef<RoomState | null>(null);
  const gameStateRef = useRef<WireGameState | null>(null);
  const reconnectNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The server stamps every game:state with the viewer's seat index
  // (sanitizeStateForPlayer). -1 is an explicit "unknown" — never a real seat.
  const [mySeatIndex, setMySeatIndex] = useState(-1);
  const [turnDeadline, setTurnDeadline] = useState<TurnDeadline>(NO_TURN_DEADLINE);

  const socket = useSocketConnection();
  const { link: ownLink, connected } = useOwnLink(socket);
  const rejoin = useRejoin(socket, userId, roomRef, gameStateRef);

  const refuse = useCallback((payload: ServerPayload) => {
    const surface = gameStateRef.current ? "table" : roomRef.current ? "room" : "lobby";
    setError({ payload, seq: ++errorSeqRef.current, surface });
  }, []);

  /** The one teardown: whatever ends a table, nothing of it survives into the next. */
  const resetTable = useCallback(() => {
    rejoin.release();
    roomRef.current = null;
    gameStateRef.current = null;
    setRoom(null);
    setGameState(null);
    setMySeatIndex(-1);
    setTurnDeadline(NO_TURN_DEADLINE);
    setIsSpectator(false);
    setPlayerLeft(false);
    setRejoinFailed(false);
    setError(null);
    setReconnectNotice(null);
    if (reconnectNoticeTimerRef.current) clearTimeout(reconnectNoticeTimerRef.current);
    setRematchVoteState(null);
    setEndMatchVoteState(null);
    setDisconnectedSeats({});
    setAutoPassed(0);
    setMatchState(INITIAL_MATCH);
    setCumulativeScores({});
    setPlacementPoints({});
    setPlacementPointsCurrent(false);
    setRatingDeltas({});
    setRoundRecorded(false);
    setRatingsAfter({});
  }, [rejoin]);

  /**
   * Gives up on the rejoin: the player is told why, then the table goes, which
   * is what sends them back to the lobby. The reason is shown first — the server
   * distinguishes a vacated seat from a finished match from a deploy that
   * invalidated it, and the teardown alone reads as the table simply vanishing.
   */
  const abandonRejoin = useCallback(
    (payload: ServerPayload) => {
      // A seat the table gave up is the server accounting for itself, not a
      // refusal: same teardown, but nothing went wrong and it should not read
      // as though it did.
      const released = payload.code === "SEAT_RELEASED";
      showNotification({
        type: released ? "game_info" : "game_error",
        title: t(released ? "onlineGame.seatReleasedTitle" : "onlineGame.rejoinFailedTitle"),
        message: translateServerPayload(payload),
        duration: Reading.notice,
      });
      resetTable();
      setRejoinFailed(true);
    },
    [showNotification, resetTable]
  );

  useEffect(() => {
    const onConnect = () => {
      rejoin.attempt();
    };

    // Rendering is all the parse protects; the server decides every outcome.
    // The room is forgotten so a cold start does not rejoin into the same payload.
    const unreadable = (event: string, error: unknown) => {
      rejoin.hold({ roomId: null });
      reportError(new Error(`${event} does not match this bundle's protocol: ${String(error)}`));
      requireUpdate();
    };

    const onRoomState = (raw: unknown) => {
      const parsed = roomStateSchema.safeParse(raw);
      if (!parsed.success) return unreadable("room:state", parsed.error);
      const data = parsed.data as unknown as RoomState;
      roomRef.current = data;
      setRoom(data);
      rejoin.answered();
      rejoin.hold(handlesFor(data));
    };

    // Server payloads carry { code, params, message }; render the code in the
    // player's language and fall back to the server's own English text if
    // the code is not one we recognize.
    const onRoomError = (payload: ServerPayload) => {
      // A refused `room:rejoin` is the one room:error that answers a room the
      // player no longer holds: the lobby on screen is a roster the server has
      // already dropped them from, so it goes with the error rather than
      // leaving them waiting on a game they are not in.
      if (rejoin.lobbyRefused(payload.code)) resetTable();
      // `spectateRoom` claims the flag before the server has answered, and a
      // refusal is the only answer some attempts ever get. Left set it would
      // send `room:unspectate` for the next table the player actually sits at,
      // which releases nothing — the seat stays occupied and keeps being dealt.
      setIsSpectator(false);
      refuse(payload);
    };

    const onGameState = (
      raw: unknown,
      // Answering is the whole point: a broadcast nobody confirms is re-sent,
      // and the last state of a round has no later one to correct it.
      ack?: () => void
    ) => {
      ack?.();
      const parsed = gameStateSchema.safeParse(raw);
      if (!parsed.success) return unreadable("game:state", parsed.error);
      const state = parsed.data as unknown as WireGameState;
      rejoin.answered();
      if (typeof state.turnSecondsRemaining === "number") {
        setTurnDeadline({
          turnDeadlineMs: state.turnDeadlineMs,
          turnSecondsRemaining: state.turnSecondsRemaining,
        });
      }
      if (typeof state.viewerSeatIndex === "number") {
        setMySeatIndex(state.viewerSeatIndex);
      }

      const prev = gameStateRef.current;
      const announced = exchangeAnnouncementOf(prev, state);
      if (announced) announce(announced);

      // A finished table re-sent (a reclaimed seat, say) comes without the
      // tally, which the server still holds.
      const sameResults = state.roundOver && prev?.roundOver === true;
      gameStateRef.current = state;
      setGameState(state);
      if (!sameResults) setRematchVoteState(null);
      if (!state.roundOver) setPlacementPointsCurrent(false);

      // The match genuinely ending is the only reason to forget the room while
      // still seated; a rematch re-arms it on the next non-final state.
      if (state.roundOver) {
        rejoin.hold({ roomId: null });
      } else if (roomRef.current) {
        rejoin.hold({ roomId: roomRef.current.roomId });
      }
      // A dealt table is not a lobby any more, and `room:start` broadcasts no
      // fresh room:state — this is the only thing that retires the handle.
      rejoin.hold({ waitingCode: null });
    };

    const onGameNotification = (
      payload: ServerPayload & { type: string }
    ) => {
      const text = translateServerPayload(payload);
      const dealt = gameStateRef.current;
      const me = dealt?.players[dealt.viewerSeatIndex ?? -1]?.name;
      // The server names the seat by the dealt `players[seat].name`, so that is what is compared; the
      // viewer's own pass is the table's float, not a banner.
      if (payload.code === "PLAYER_AFK_AUTO_PASS" && me !== undefined && payload.params?.username === me) {
        setAutoPassed((n) => n + 1);
      } else if (payload.type === "afk") {
        showNotification({
          type: "afk",
          title: t("game.autoPassTitle"),
          message: text,
          duration: Reading.notice,
        });
      } else {
        showNotification({
          type: "game_info",
          title: t("common.notice"),
          message: text,
          duration: Reading.notice,
        });
      }
    };

    const onMatchState = ({
      target,
      length,
      roundsPlayed,
      scores,
    }: {
      target: number;
      length: MatchLength;
      roundsPlayed?: number;
      scores: Record<string, number>;
    }) => {
      setMatchState({ ...INITIAL_MATCH, target, length, roundsPlayed: roundsPlayed ?? 0 });
      setCumulativeScores(scores);
      // No round has been played on this match yet, so nothing has been
      // awarded — carrying the last match's deltas over would print them
      // beside a fresh scoreboard.
      setPlacementPoints({});
      setRatingDeltas({});
      setRatingsAfter({});
      setRoundRecorded(false);
    };

    const onRoundOver = (raw: unknown) => {
      const parsed = roundOverSchema.safeParse(raw);
      if (!parsed.success) return unreadable("game:round_over", parsed.error);
      const {
        scores,
        matchTarget,
        matchLength,
        roundsPlayed,
        matchOver,
        matchWinnerIds,
        matchContinues,
        isDraw,
        ratingDeltas,
        ratingsAfter,
        recorded,
      } = parsed.data as unknown as RoundOverPayload;
      // Kept whole and keyed by user id: this context has no identity of its
      // own, and the overlay that shows the number already knows whose it is.
      // Undefined and empty are the same answer — the round rated nobody.
      setRatingDeltas(ratingDeltas ?? {});
      setRatingsAfter(ratingsAfter ?? {});
      setRoundRecorded(recorded);
      setPlacementPointsCurrent(true);
      if (scores) {
        setCumulativeScores(Object.fromEntries(scores.map((r) => [r.engineId, r.total])));
        setPlacementPoints(Object.fromEntries(scores.map((r) => [r.engineId, r.points])));
      }
      setMatchState((prev) => ({
        target: matchTarget ?? prev.target,
        length: matchLength ?? prev.length,
        roundsPlayed: roundsPlayed ?? prev.roundsPlayed,
        over: matchOver ?? false,
        winners: matchWinnerIds ?? [],
        isDraw: isDraw ?? false,
        continues: matchContinues ?? false,
      }));
      // The stats queries are configured with `staleTime: Infinity`
      // (lib/query-client.ts), so without this the profile keeps showing
      // whatever it read on first open for the rest of the session — a player
      // finishes a match and their counters, history and achievements do not
      // move. A round just finished, so this is exactly when they are stale.
      qc.invalidateQueries({ queryKey: ["/api/stats/me"] });
      qc.invalidateQueries({ queryKey: ["/api/stats/history"] });
      qc.invalidateQueries({ queryKey: ["/api/stats/achievements"] });
      qc.invalidateQueries({ queryKey: ["/api/ratings/me"] });
      qc.invalidateQueries({ queryKey: LADDER_KEY });
    };

    const onVoteState = (vs: RematchVoteState) => setRematchVoteState(vs);
    const onEndMatchVoteState = (vs: RematchVoteState) => setEndMatchVoteState(vs);

    const onReaction = (r: { emoji: string; fromSeat: number; username: string }) =>
      pushReaction(r);

    const onPlayerLeft = () => setPlayerLeft(true);

    // A vacated seat handed to a bot — the table survives, so this is a
    // notice and nothing more. It must stay separate from game:player_left,
    // which drives the blocking "Match interrupted" teardown and would eject
    // every remaining human from a game the server is still keeping alive.
    const onSeatBotTakeover = (
      payload: ServerPayload & { userId: string; username: string; seatIndex: number }
    ) => {
      showNotification({
        type: "game_info",
        title: t("common.notice"),
        message: translateServerPayload(payload),
        duration: Reading.notice,
      });
      // The seat is vacated now, not merely disconnecting — the sanitized
      // state's own `vacated` flag carries the label from here on.
      setDisconnectedSeats((cur) => {
        if (!(payload.seatIndex in cur)) return cur;
        const next = { ...cur };
        delete next[payload.seatIndex];
        return next;
      });
    };

    const onPlayerDisconnected = (
      payload: ServerPayload & { userId: string; seatIndex?: number | null }
    ) => {
      // Kept as the server's payload, not rebuilt as a sentence: its
      // `params.seconds` is the grace the server is configured with.
      const notice = { payload, back: false };
      setReconnectNotice(notice);
      if (reconnectNoticeTimerRef.current) clearTimeout(reconnectNoticeTimerRef.current);
      reconnectNoticeTimerRef.current = setTimeout(() => {
        setReconnectNotice((cur) => (cur === notice ? null : cur));
      }, 10_000);

      // The seat itself carries this for the whole grace, not a ten-second
      // banner — driven from the server's own `params.seconds`, never a
      // second client-side clock.
      const seconds = payload.params?.seconds;
      const seatIndex = payload.seatIndex;
      if (typeof seatIndex === "number" && typeof seconds === "number") {
        setDisconnectedSeats((cur) => ({
          ...cur,
          [seatIndex]: { seconds, resetKey: `${seatIndex}|${Date.now()}` },
        }));
      }
    };

    const onPlayerReconnected = (
      payload: ServerPayload & { userId: string; seatIndex?: number | null }
    ) => {
      const notice = { payload, back: true };
      setReconnectNotice(notice);
      if (reconnectNoticeTimerRef.current) clearTimeout(reconnectNoticeTimerRef.current);
      reconnectNoticeTimerRef.current = setTimeout(() => {
        setReconnectNotice((cur) => (cur === notice ? null : cur));
      }, 3_500);

      if (typeof payload.seatIndex === "number") {
        const seat = payload.seatIndex;
        setDisconnectedSeats((cur) => {
          if (!(seat in cur)) return cur;
          const next = { ...cur };
          delete next[seat];
          return next;
        });
      }
    };

    const onRejoinFailed = (data: ServerPayload & { roomId?: string }) => {
      // Act only on a reply for the room still being waited on. The server
      // echoes the requested room id verbatim at every emit site, and live
      // state for any room clears the ref — so anything that does not match
      // answers an attempt the player has already moved past.
      if (!rejoin.answers(data.roomId)) return;

      // SERVER_ERROR is the rejoin handler's blanket catch — a database blip
      // during the round-trip, not a table that has gone. Everything the next
      // attempt needs is kept and the attempt stays outstanding, so its reply
      // is still allowed to act. A retry that sends nothing is the end of the
      // line: no reply is coming.
      if (data.code === "SERVER_ERROR" && rejoin.retry(() => abandonRejoin(data))) return;

      abandonRejoin(data);
    };

    // The room-wide announcement that the lobby is over. `game:state` is
    // addressed to one player and is the only other thing that says so, so a
    // player it does not reach has nothing else to act on: this is what turns
    // a missed deal into one extra round trip instead of a stranded screen.
    const onGameStarted = () => {
      if (gameStateRef.current) return;
      rejoin.attempt();
    };

    socket?.on("game:started", onGameStarted);
    socket?.on("connect", onConnect);
    socket?.on("room:state", onRoomState);
    socket?.on("room:error", onRoomError);
    socket?.on("game:state", onGameState);
    socket?.on("game:turn_deadline", setTurnDeadline);
    socket?.on("game:error", refuse);
    socket?.on("game:notification", onGameNotification);
    socket?.on("game:round_over", onRoundOver);
    socket?.on("game:match_state", onMatchState);
    socket?.on("game:vote_state", onVoteState);
    socket?.on("game:end_match_vote_state", onEndMatchVoteState);
    socket?.on("game:reaction", onReaction);
    socket?.on("game:player_left", onPlayerLeft);
    socket?.on("game:seat_bot_takeover", onSeatBotTakeover);
    socket?.on("game:player_disconnected", onPlayerDisconnected);
    socket?.on("game:player_reconnected", onPlayerReconnected);
    socket?.on("game:rejoin_failed", onRejoinFailed);

    return () => {
      socket?.off("game:started", onGameStarted);
      socket?.off("connect", onConnect);
      socket?.off("room:state", onRoomState);
      socket?.off("room:error", onRoomError);
      socket?.off("game:state", onGameState);
      socket?.off("game:turn_deadline", setTurnDeadline);
      socket?.off("game:error", refuse);
      socket?.off("game:notification", onGameNotification);
      socket?.off("game:round_over", onRoundOver);
      socket?.off("game:match_state", onMatchState);
      socket?.off("game:vote_state", onVoteState);
      socket?.off("game:end_match_vote_state", onEndMatchVoteState);
      socket?.off("game:reaction", onReaction);
      socket?.off("game:player_left", onPlayerLeft);
      socket?.off("game:seat_bot_takeover", onSeatBotTakeover);
      socket?.off("game:player_disconnected", onPlayerDisconnected);
      socket?.off("game:player_reconnected", onPlayerReconnected);
      socket?.off("game:rejoin_failed", onRejoinFailed);
      // This timer owns a setState that would otherwise fire after unmount.
      if (reconnectNoticeTimerRef.current) clearTimeout(reconnectNoticeTimerRef.current);
      // The reaction store outlives this provider, so its contents and its
      // pending removals both have to go with the table.
      clearReactions();
    };
  }, [socket, rejoin, resetTable, abandonRejoin, showNotification, qc, announce, refuse]);

  /**
   * Every intent waits to be told it arrived and says so if it never was — a
   * move that vanished used to look exactly like a player who did not move.
   */
  const deliver = useCallback(
    <E extends IntentEvent>(event: E, payload?: IntentPayload<E>, options?: { retry?: boolean }) => {
      void send(socket, event, payload, options).then((outcome) => {
        if (!undelivered(outcome)) return;
        notifyError(t(event.startsWith("game:") ? "game.moveNotDelivered" : "room.requestNotDelivered"), {
          duration: Reading.notice,
        });
      });
    },
    [socket, notifyError]
  );

  const createRoom = useCallback((gameMode: "free_for_all" | "teams", maxPlayers: number) => {
    setEntrySource("friends");
    // A rejoin_failed latched by an earlier, unrelated room (e.g. a
    // force-quit from a waiting lobby) must not survive into a room the
    // player is deliberately starting fresh. The outstanding `game:rejoin` ref
    // is left alone on purpose — it is cleared only by a reply that matches it,
    // which is what makes the stale-reply guard a guard.
    setRejoinFailed(false);
    // Taking a seat is not watching, whatever an earlier spectate attempt left
    // behind: the flag decides whether leaving this room releases the seat.
    setIsSpectator(false);
    setError(null);
    rejoin.cancelLobby();
    deliver("room:create", { gameMode, maxPlayers }, { retry: false });
  }, [deliver, rejoin]);

  const joinRoom = useCallback((input: string) => {
    const code = joinCode(input);
    if (!code) return;
    setEntrySource("friends");
    setRejoinFailed(false);
    setIsSpectator(false);
    // A new attempt retires the last one's refusal. The banner is dismissed by
    // hand and by nothing else, so a standing error otherwise outlives the
    // table it was about and hides this join's own answer behind it.
    setError(null);
    rejoin.cancelLobby();
    deliver("room:join", { code }, { retry: false });
  }, [deliver, rejoin]);

  const spectateRoom = useCallback(
    (input: string) => {
      const code = joinCode(input);
      if (!code) return;
      setIsSpectator(true);
      setRejoinFailed(false);
      setError(null);
      rejoin.cancelLobby();
      deliver("room:spectate", { code });
    },
    [deliver, rejoin]
  );

  const leaveRoom = useCallback(() => {
    // A spectator never took a seat, so room:leave has nothing to release —
    // sending it anyway would run the seated teardown for a table this socket
    // does not occupy.
    if (isSpectator) deliver("room:unspectate");
    else deliver("room:leave");
    resetTable();
  }, [deliver, isSpectator, resetTable]);

  const quickmatch = useCallback((maxPlayers: number, gameMode: "free_for_all" | "teams") => {
    setEntrySource("quickmatch");
    setRejoinFailed(false);
    setIsSpectator(false);
    setError(null);
    rejoin.cancelLobby();
    deliver("room:quickmatch", { maxPlayers, gameMode }, { retry: false });
  }, [deliver, rejoin]);

  const setRoomVisibility = useCallback((visibility: "public" | "private") => {
    deliver("room:setVisibility", { visibility });
  }, [deliver]);

  const startGame = useCallback((opts?: {
    fillWithBots?: boolean;
    botPersonality?: BotPersonalityId;
    matchLength?: MatchLength;
  }) => {
    deliver("room:start", opts);
  }, [deliver]);

  const voteRematch = useCallback(() => {
    deliver("game:rematch_vote");
  }, [deliver]);

  const voteToEndMatch = useCallback((wants: boolean) => {
    deliver("game:end_match_vote", { wants });
  }, [deliver]);

  const playCards = useCallback(
    (cardIds: string[]) => deliver("game:play", { cardIds }),
    [deliver]
  );

  const pass = useCallback(() => deliver("game:pass"), [deliver]);

  const giveExchangeCard = useCallback(
    (cardId: string) => deliver("game:exchange_give_card", { cardId }),
    [deliver]
  );

  const sendReaction = useCallback((emoji: string) => {
    deliver("game:reaction", { emoji });
  }, [deliver]);

  const clearError = useCallback(
    (seq: number) => setError((cur) => (cur?.seq === seq ? null : cur)),
    []
  );
  const clearPlayerLeft = useCallback(() => setPlayerLeft(false), []);
  const clearRejoinFailed = useCallback(() => setRejoinFailed(false), []);
  const retryConnection = useCallback(() => {
    socket?.disconnect().connect();
  }, [socket]);

  // One memo per slice, each over only its own state. Two slices sharing a
  // memo, or a dep list reaching past its own slice, is a split that passes
  // every shape check and saves nothing — which is why what pins these is a
  // render count (tests/native/sliceRenderCounts.test.tsx).
  const pill = linkPill(ownLink, connected, !!reconnectNotice?.back);
  const connectionValue = useMemo(
    () => ({
      connected,
      error,
      reconnectNotice,
      playerLeft,
      rejoinFailed,
      clearError,
      clearPlayerLeft,
      clearRejoinFailed,
      retryConnection,
      ownLink,
      pill,
    }),
    [connected, error, reconnectNotice, playerLeft, rejoinFailed, clearError, clearPlayerLeft, clearRejoinFailed, retryConnection, ownLink, pill]
  );

  const hasGame = gameState !== null;
  const roomValue = useMemo(
    () => ({
      room,
      entrySource,
      isSpectator,
      hasGame,
      createRoom,
      joinRoom,
      spectateRoom,
      leaveRoom,
      quickmatch,
      setRoomVisibility,
      startGame,
    }),
    [room, entrySource, isSpectator, hasGame, createRoom, joinRoom, spectateRoom, leaveRoom, quickmatch, setRoomVisibility, startGame]
  );

  const tableValue = useMemo(
    () => ({ gameState, mySeatIndex, playCards, pass, sendReaction, disconnectedSeats, autoPassed }),
    [gameState, mySeatIndex, playCards, pass, sendReaction, disconnectedSeats, autoPassed]
  );

  const turnClockValue = useMemo(
    () => ({
      turnSeconds: turnDeadline.turnSecondsRemaining,
      turnDeadlineMs: turnDeadline.turnDeadlineMs,
    }),
    [turnDeadline]
  );

  const matchValue = useMemo(
    () => ({
      matchState,
      cumulativeScores,
      placementPoints,
      placementPointsCurrent,
      ratingDeltas,
      roundRecorded,
      ratingsAfter,
      rematchVoteState,
      endMatchVoteState,
      voteRematch,
      voteToEndMatch,
    }),
    [matchState, cumulativeScores, placementPoints, placementPointsCurrent, ratingDeltas, roundRecorded, ratingsAfter, rematchVoteState, endMatchVoteState, voteRematch, voteToEndMatch]
  );

  const exchangeValue = useMemo(
    () => ({ exchangeAnnouncing, exchangeAnnounceData, giveExchangeCard, acknowledgeExchange }),
    [exchangeAnnouncing, exchangeAnnounceData, giveExchangeCard, acknowledgeExchange]
  );

  return (
    <ConnectionContext.Provider value={connectionValue}>
      <RoomContext.Provider value={roomValue}>
        <TableContext.Provider value={tableValue}>
          <TurnClockContext.Provider value={turnClockValue}>
            <MatchContext.Provider value={matchValue}>
              <ExchangeContext.Provider value={exchangeValue}>
                {children}
              </ExchangeContext.Provider>
            </MatchContext.Provider>
          </TurnClockContext.Provider>
        </TableContext.Provider>
      </RoomContext.Provider>
    </ConnectionContext.Provider>
  );
}
