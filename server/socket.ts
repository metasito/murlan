import { Server as SocketServer } from "socket.io";
import type { Socket } from "socket.io";
import type { Server as HttpServer } from "node:http";
import { eq, inArray, lt } from "drizzle-orm";
import { storage } from "./storage.ts";
import { logger } from "./logger.ts";
import { notifyUser } from "./push.ts";
import { sessionMiddleware } from "./session.ts";
import { db } from "./db.ts";
import {
  activeGames as activeGamesTable,
  roomPlayers as roomPlayersTable,
  rooms as roomsTable,
} from "../shared/schema.ts";
import { consumeSocketTicket } from "./ticket.ts";
import { isAllowedOrigin } from "./cors.ts";
import { allowSocketAction, onEvent } from "./socketSafety.ts";
import {
  readPersistedPlayerMap,
  seatOfUser as seatOfUserInMap,
  scoreKeyForSeat as scoreKeyForMapSeat,
  findViewerSeat,
  visibleExchangePhase,
  buildSeatRoster,
  teamKeyMap,
  restoredMatchOver,
  isStaleSchema,
  packPersistedState,
  unpackPersistedState,
  resolveHandEnd,
  type PersistedEnvelope,
} from "./onlineGameLogic.ts";
import {
  NoPayloadSchema,
  RoomCreateSchema,
  RoomJoinSchema,
  RoomRejoinSchema,
  RoomSpectateSchema,
  RoomQuickmatchSchema,
  RoomSetGameModeSchema,
  RoomStartSchema,
  GamePlaySchema,
  GameRejoinSchema,
  GameReactionSchema,
  GameExchangeGiveCardSchema,
  GameRematchIntentSchema,
  FriendInviteSchema,
} from "./socketSchemas.ts";
import {
  initializeGame,
  initializeRematch,
  nextDealFirstSeat,
  teamForSeat,
  TEAMS_PLAYER_COUNT,
  processPlay,
  processPass,
  processExchangeChoice,
  buildCombination,
  sortHand,
  canPlay,
  aiChoosePlay,
  getValidGivebackCards,
  getStartingPlayerAfterExchange,
  deepCloneState,
  isMajority,
  targetsFor,
} from "../lib/gameEngine.ts";
import type { GameState, Card, GameMode, Combination, MatchLength } from "../lib/gameEngine.ts";
import { recordGameResult } from "./stats.ts";
import { saveReplay } from "./replays.ts";
import { recordRatedResult } from "./ratings.ts";
import { appendReplayMove, replaySeatsOf, startReplayLog } from "./replayShape.ts";
import type { ReplayMove } from "../lib/replay.ts";

interface OnlineGameState {
  gameState: GameState;
  /** engine seat index -> userId. A missing seat is a vacated (bot) seat. */
  playerMap: Record<number, string>;
  roomId: string;
  /** Ready gate for the next manche of the running match, by userId. */
  rematchVotes: Set<string>;
  /**
   * Answers to the side-panel rematch question, by userId. Asked while the
   * closing manche is still in play and read once the match ends; a seat that
   * never answered counts as a no. Bot seats are not stored — they have no
   * userId to key by, and abstain from the verdict entirely (see
   * countRematchAnswers).
   */
  rematchIntents: Map<string, boolean>;
  /** userId (or `bot:<seat>`) -> cumulative match points. */
  cumulativeScores: Record<string, number>;
  gameMode: GameMode;
  maxPlayers: number;
  matchTarget: number;
  matchLength: MatchLength;
  matchOver: boolean;
  /**
   * seat -> combination flags played by that seat during the *current hand*
   * only (reset whenever a new hand deals — game start and rematch). Feeds
   * GameResult.playedBomb/playedJoker at game-over: the engine itself
   * (lib/gameEngine.ts) does not track this, and GameResult has no other
   * honest source for it. Persisted inside the game_state envelope alongside
   * schemaVersion, so a restart mid-hand does not silently cost the seat its
   * bomb/joker achievement eligibility.
   */
  handFlags: Record<number, { bomb: boolean; joker: boolean }>;
  /**
   * seat -> the userId who walked out on the hand being played, for seats
   * vacated while they still held cards. `playerMap` has already forgotten
   * them by then and a seat missing from it scores as `bot:<seat>`, which
   * every stats and ladder write drops, so this is the only thing that still
   * ties the seat to a person. Read at game over to record it as a real
   * last-place finish, and cleared wherever a new hand deals — the forfeit is
   * recorded once, not in every remaining manche of the match.
   *
   * In memory only: putting it in the persisted `game_state` envelope would
   * change a stored shape, and a GAME_SCHEMA_VERSION bump disposes every live
   * game on its next rejoin.
   */
  abandonedSeats: Map<number, string>;
  /**
   * When the acting seat's AFK window runs out, in server time. Undefined
   * whenever nothing is on the clock — a vacated seat waiting on a bot, or a
   * finished hand. Memory only: it is re-armed on the next move and would be
   * meaningless after a restart.
   */
  turnDeadlineMs?: number;
  /**
   * The seat the next manche deals from. The two extra cards of a 54-card
   * deal land on it and its neighbour, so it advances every manche — seat 0 is
   * always the host, and a fixed origin hands the host's half of the table a
   * bigger hand for the whole match.
   */
  dealFirstSeat: number;
  /**
   * userIds watching without a seat. Deliberately not persisted: a spectator
   * who reconnects spectates again, and a restart dropping them costs nothing.
   */
  spectators: Set<string>;
  /**
   * This hand's move log, written once to `match_replays` at game over.
   *
   * In memory only, unlike handFlags: the game_state envelope is rewritten
   * after every move, and carrying a few hundred combinations through each of
   * those writes would buy nothing but a replay of a hand a restart
   * interrupted — a hand that has no replay yet either way. `null` means this
   * hand cannot produce one (rehydrated after a restart, or past
   * MAX_REPLAY_MOVES) and nothing will be written for it.
   */
  moveLog: ReplayMove[] | null;
}

const activeGames = new Map<string, OnlineGameState>();
const socketRoomMap = new Map<string, string>();
// Spectators are tracked apart from socketRoomMap on purpose: that map drives
// the disconnect and leave paths for *seated* players, and a spectator dropping
// out must not run a single line of them.
const spectatorRoomMap = new Map<string, string>();
const userSocketMap = new Map<string, string>();
const publicRoomIds = new Set<string>();

/**
 * Who lost their connection to a waiting lobby, per room id: userId -> whether
 * they held the room at the moment they dropped.
 *
 * A lobby disconnect deletes the `room_players` row immediately, so nothing in
 * the database still says the caller was ever seated. This is that evidence,
 * and `room:rejoin` is its only reader: without an entry (and without a
 * surviving seat row) a caller holding the six-character code is arriving, not
 * returning, and `room:join` is their event. It is also the only thing that may
 * hand the room back — the host role returns to the account that lost it and to
 * nobody else.
 *
 * In memory: a restart drops every socket anyway, so there is no reconnect left
 * to answer.
 */
const lobbyDropouts = new Map<string, Map<string, boolean>>();

function rememberLobbyDropout(roomId: string, userId: string, wasHost: boolean) {
  const room = lobbyDropouts.get(roomId) ?? new Map<string, boolean>();
  room.set(userId, wasHost);
  lobbyDropouts.set(roomId, room);
}

function forgetLobbyDropout(roomId: string, userId: string) {
  const room = lobbyDropouts.get(roomId);
  if (!room) return;
  room.delete(userId);
  if (room.size === 0) lobbyDropouts.delete(roomId);
}

// Timers. Every entry added here has exactly one matching delete — see
// clearAfkTimer / clearRoomTimers / clearAllTimersForUser / disposeGame.
const afkTimers = new Map<string, ReturnType<typeof setTimeout>>();
const disconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
const botTimers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Read once at module scope, never per-call — a test process boots this
 * module a single time (see tests/helpers/testServer.ts), so this is safe to
 * shorten via env var without touching the production defaults below, which
 * apply whenever the var is unset (always, in production).
 */
function timeoutFromEnv(name: string, defaultMs: number): number {
  const raw = process.env[name];
  if (!raw) return defaultMs;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultMs;
}

const AFK_TIMEOUT_MS = timeoutFromEnv("MURLAN_AFK_TIMEOUT_MS", 30_000);
const DISCONNECT_GRACE_MS = timeoutFromEnv("MURLAN_DISCONNECT_GRACE_MS", 60_000);
// Paced so a bot seat reads as thinking rather than as an instant reflex.
// Tunable for tests, which otherwise pay it on every move of every table a
// disconnect hands over to the AI.
const BOT_MOVE_DELAY_MS = timeoutFromEnv("MURLAN_BOT_MOVE_DELAY_MS", 1_200);
const SWEEP_INTERVAL_MS = 5 * 60_000;

/**
 * How long an `active_games` row may sit untouched before it is abandoned.
 *
 * The in-memory sweep cannot see these. A restart empties `activeGames`, and
 * every path that deletes a row — a table finishing, the last human leaving,
 * the disconnect grace expiring — walks that Map. A game that was live when the
 * process went down, and that nobody ever rejoins, is invisible to all of them
 * and its row stays forever. On a host that sleeps, which is where this app
 * runs, that happens on every sleep with a game open.
 *
 * A day is far past any live game: `persistGameState` refreshes `updated_at` on
 * every single move, and a table nobody is playing is disposed within the
 * disconnect grace. The margin is there so a row a player might still
 * legitimately rejoin is never taken out from under them.
 */
const ABANDONED_GAME_MAX_AGE_MS = 24 * 60 * 60_000;

/**
 * How long a `rooms` row may live before the sweeper takes it.
 *
 * Derived from `created_at` rather than a "finished at" column, because a
 * timestamp on `rooms` would be a new column on a table written every time
 * anyone opens a table — the write that breaks until `db:push` runs. No game
 * lasts a day, so age alone separates a live room from a dead one, and it
 * covers the rooms a restart stranded in `waiting` as well as the finished
 * ones.
 */
const STALE_ROOM_MAX_AGE_MS = 24 * 60 * 60_000;

/** Rooms deleted per sweep. Bounds the size of one statement, not the total. */
const STALE_ROOM_BATCH = 500;

/**
 * Handshakes one account may complete per minute.
 *
 * Socket.io answers `/socket.io/*` on the shared http.Server before Express
 * ever sees it, so no express-rate-limit instance reaches the handshake — and
 * an accepted connection costs several database round-trips before the client
 * has emitted anything. Matched to the ticket limiter's 60/min
 * (`server/routes.ts`), which mints one ticket per connection attempt: a
 * smaller budget here would lock a phone out of its own game while its
 * connection flaps.
 */
const HANDSHAKES_PER_MINUTE = 60;
const HANDSHAKE_WINDOW_MS = 60_000;

let _io: SocketServer | null = null;

export function emitToUser(userId: string, event: string, data: unknown) {
  if (!_io) return;
  const socketId = userSocketMap.get(userId);
  if (socketId) {
    _io.to(socketId).emit(event, data);
  }
}

export function isUserOnline(userId: string): boolean {
  return userSocketMap.has(userId);
}

/**
 * Throws an account off the server once its `users` row is gone: the seat is
 * released to a bot exactly as a `room:leave` does, and the socket is closed.
 *
 * A socket authenticates once at the handshake and `socket.data.userId` is
 * never re-checked, so without this a deleted account keeps its seat and keeps
 * playing under an id no row answers to.
 *
 * Call it only after the delete has committed — releasing the seat can end the
 * hand, and the hand's writes must not race the transaction removing the row.
 * Never throws: the account is already gone, and the caller's response must not
 * turn on how the teardown went.
 */
export async function evictUser(userId: string): Promise<void> {
  const io = _io;
  if (!io) return;
  const socketId = userSocketMap.get(userId);
  if (!socketId) return;
  userSocketMap.delete(userId);
  const socket = io.sockets.sockets.get(socketId);
  if (!socket) return;

  // Taken here so the disconnect below cannot release the same seat a second
  // time. Spectator state is left to it, which drops it correctly.
  const roomId = socketRoomMap.get(socketId);
  socketRoomMap.delete(socketId);
  const username = (socket.data?.username as string) ?? "";

  if (roomId) {
    try {
      if (activeGames.has(roomId)) {
        // Not handleSeatRelease: deleting an account also deletes the rooms
        // rows it hosted, and that path reads the room back and returns when
        // it is gone — leaving the seat live in a hand still being played.
        socket.leave(roomId);
        await vacateSeat(io, roomId, userId, username);
      } else {
        await handleSeatRelease(io, roomId, userId, username, {
          socket,
          source: "leave",
        });
      }
    } catch (err) {
      logger.error(
        { err, userId, roomId },
        "Failed to release the seat of a deleted account"
      );
    }
  }

  socket.disconnect(true);
}

/**
 * Internals exposed for tests only — the turn resolution and persistence
 * mapping are the two places where a bug deadlocks a live table, so they have
 * to be exercisable without a socket server and a database.
 */
export const __testables = {
  actingSeat: (state: GameState) => actingSeat(state),
  autoMoveForSeat: (state: GameState, seat: number, useAi: boolean) =>
    autoMoveForSeat(
      { gameState: state, handFlags: {}, moveLog: null } as OnlineGameState,
      seat,
      useAi
    ),
  /**
   * Same as autoMoveForSeat, but also returns the OnlineGameState.handFlags
   * an AFK-forced/bot move produced — regression coverage for the
   * bomb/joker achievement bookkeeping living in recordPlayFlags, which a
   * bare GameState result can't expose.
   */
  autoMoveForSeatWithFlags: (state: GameState, seat: number, useAi: boolean) => {
    const game = { gameState: state, handFlags: {}, moveLog: null } as OnlineGameState;
    const next = autoMoveForSeat(game, seat, useAi);
    return { state: next, handFlags: game.handFlags };
  },
  readPersistedPlayerMap: (storedMap: unknown, storedIds: unknown) =>
    readPersistedPlayerMap(storedMap, storedIds),
  countRematchAnswers: (game: OnlineGameState) => countRematchAnswers(game),
  tableWantsRematch: (game: OnlineGameState) => tableWantsRematch(game),
  /**
   * Whether a room still holds a live in-memory game. The only observable
   * difference between a disposed table and one that merely stopped emitting,
   * since disposal deletes the `active_games` row without awaiting it.
   */
  hasActiveGame: (roomId: string) => activeGames.has(roomId),
  /**
   * Drops a room's live game and its timers while leaving the `active_games`
   * row alone — exactly what a process restart leaves behind, and the only
   * way a test can reach `game:rejoin`'s rehydration branch.
   */
  forgetActiveGame: (roomId: string) => {
    clearRoomTimers(roomId);
    return activeGames.delete(roomId);
  },
  /**
   * A snapshot of the seat -> userId map a room's live game is routing hands
   * by. It is the only thing that decides whose cards a viewer is sent, and
   * which seats the turn arbiter drives with the AI, so a test asserting that
   * a seat did not move under a player has to read it directly.
   */
  seatedUsers: (roomId: string) => {
    const game = activeGames.get(roomId);
    return game ? { ...game.playerMap } : null;
  },
  /**
   * The match bookkeeping of a room's live game: the format, the target, the
   * running scores and the identity of the hand on the table. A second deal
   * path is only observable through these — the clients see an ordinary
   * `game:started` either way.
   */
  matchSnapshot: (roomId: string) => {
    const game = activeGames.get(roomId);
    if (!game) return null;
    return {
      matchLength: game.matchLength,
      matchTarget: game.matchTarget,
      matchOver: game.matchOver,
      cumulativeScores: { ...game.cumulativeScores },
      rankings: [...game.gameState.rankings],
      dealFirstSeat: game.dealFirstSeat,
    };
  },
  /**
   * The containment every timer body runs under. Exposed because the property
   * that matters — a throw closes the table instead of freezing it — is not
   * reachable through a socket: it needs a body that throws on demand.
   */
  runTimerBody: (label: string, roomId: string, fn: () => void) =>
    safeTimer(label, roomId, fn),
  /** The restart-orphan prune, which only a real database can exercise. */
  pruneAbandonedGames: () => pruneAbandonedGames(),
  ABANDONED_GAME_MAX_AGE_MS,
  pruneStaleRooms,
  STALE_ROOM_MAX_AGE_MS,
};

function sanitizeStateForPlayer(
  state: GameState,
  viewerUserId: string,
  playerMap: Record<number, string>,
  turnDeadlineMs?: number
) {
  // The server knows which seat the viewer occupies authoritatively; ship it
  // with every state so the client never has to derive it (e.g. from a lobby
  // `room` object that is null across a cold-start rejoin).
  const viewerSeatIndex = findViewerSeat(playerMap, viewerUserId);
  return {
    ...state,
    viewerSeatIndex,
    // Seconds rather than the deadline itself: a device whose clock is off by
    // minutes would render an absolute timestamp as a clock that is already
    // over or never moves. The deadline rides along only as a reset key.
    turnDeadlineMs,
    turnSecondsRemaining: secondsUntil(turnDeadlineMs),
    // Strips `cardFromLoser` — a named card out of a named player's hand —
    // down to only the two seats in the exchange, and only while it is active.
    exchangePhase: visibleExchangePhase(
      state.exchangePhase,
      viewerSeatIndex
    ) as GameState["exchangePhase"],
    players: state.players.map((p, idx) => {
      const isViewer = playerMap[idx] === viewerUserId;
      return {
        ...p,
        hand: isViewer ? p.hand : ([] as Card[]),
        handCount: p.hand.length,
      };
    }),
  };
}


// ─── Timer bookkeeping ────────────────────────────────────────────────────────

function clearAfkTimer(roomId: string, userId: string) {
  const key = `${roomId}:${userId}`;
  const t = afkTimers.get(key);
  if (t) {
    clearTimeout(t);
    afkTimers.delete(key);
  }
}

function clearRoomAfkTimers(roomId: string) {
  const prefix = `${roomId}:`;
  for (const [key, timer] of afkTimers) {
    if (key.startsWith(prefix)) {
      clearTimeout(timer);
      afkTimers.delete(key);
    }
  }
}

function clearBotTimer(roomId: string) {
  const t = botTimers.get(roomId);
  if (t) {
    clearTimeout(t);
    botTimers.delete(roomId);
  }
}

function clearRoomTimers(roomId: string) {
  clearRoomAfkTimers(roomId);
  clearBotTimer(roomId);
}

function clearAllTimersForUser(userId: string, roomId?: string) {
  const dcTimer = disconnectTimers.get(userId);
  if (dcTimer) {
    clearTimeout(dcTimer);
    disconnectTimers.delete(userId);
  }
  if (roomId) {
    clearAfkTimer(roomId, userId);
  }
}

/** Cancels the grace timers of everyone seated in this room. */
function clearRoomDisconnectTimers(game: OnlineGameState) {
  for (const uid of Object.values(game.playerMap)) {
    const t = disconnectTimers.get(uid);
    if (t) {
      clearTimeout(t);
      disconnectTimers.delete(uid);
    }
  }
}

/** Drops every in-memory trace of a room. */
function disposeGame(roomId: string, deleteRow = true) {
  const game = activeGames.get(roomId);
  if (game) clearRoomDisconnectTimers(game);
  clearRoomTimers(roomId);
  activeGames.delete(roomId);
  publicRoomIds.delete(roomId);
  if (deleteRow) {
    db.delete(activeGamesTable)
      .where(eq(activeGamesTable.roomCode, roomId))
      .catch((err: unknown) =>
        logger.error({ err, roomId }, "Failed to delete persisted game")
      );
  }
}

// ─── Persistence ──────────────────────────────────────────────────────────────

/**
 * Writes the room's live state. Failures are logged, never thrown — a
 * persistence problem must not break a table. The promise is returned so a
 * caller that is about to delete the same row can order itself after it.
 */
function persistGameState(roomId: string, game: OnlineGameState): Promise<unknown> {
  const playerIds = Object.values(game.playerMap);
  const playerMap = game.playerMap as Record<string, string>;
  // Stamped so a restart can tell a current-shape row from a stale one (see
  // GAME_SCHEMA_VERSION) rather than restoring a corrupt hand silently.
  const persistedState = packPersistedState(game.gameState, game.handFlags, game.dealFirstSeat);
  const values = {
    roomCode: roomId,
    gameState: persistedState as any,
    playerIds: playerIds as any,
    playerMap: playerMap as any,
    scores: game.cumulativeScores as any,
    isPublic: publicRoomIds.has(roomId),
    maxPlayers: game.maxPlayers,
    gameMode: game.gameMode,
    matchTarget: game.matchTarget,
    matchLength: game.matchLength,
    updatedAt: new Date(),
  };
  return db
    .insert(activeGamesTable)
    .values(values)
    .onConflictDoUpdate({
      target: activeGamesTable.roomCode,
      // Everything mutable is refreshed on every write — seats, scores, mode
      // and player list — so a restored game comes back with the correct
      // seats and scoreboard instead of as a free-for-all.
      set: {
        gameState: values.gameState,
        playerIds: values.playerIds,
        playerMap: values.playerMap,
        scores: values.scores,
        isPublic: values.isPublic,
        maxPlayers: values.maxPlayers,
        gameMode: values.gameMode,
        matchTarget: values.matchTarget,
        matchLength: values.matchLength,
        updatedAt: values.updatedAt,
      },
    })
    .catch((err: unknown) =>
      logger.error({ err, roomId }, "Failed to persist game state")
    );
}

function broadcastGameState(io: SocketServer, game: OnlineGameState) {
  const { gameState, playerMap } = game;
  const send = (uid: string) => {
    const target = userSocketMap.get(uid);
    if (!target) return;
    io.to(target).emit("game:state", sanitizeStateForPlayer(gameState, uid, playerMap, game.turnDeadlineMs));
  };
  Object.values(playerMap).forEach(send);
  // Spectators go through the same sanitiser. findViewerSeat returns null for
  // a userId that holds no seat, and every hand is blanked on that basis, so a
  // spectator cannot be sent a card without the seated path breaking first.
  game.spectators.forEach(send);
}

// ─── Turn arbitration ─────────────────────────────────────────────────────────

/** The seat that must act right now: the exchange winner, or the turn holder. */
function actingSeat(state: GameState): number {
  return state.exchangePhase?.active
    ? state.exchangePhase.winnerIdx
    : state.currentTurnIndex;
}

function scoreKeyForSeat(game: OnlineGameState, seat: number): string {
  return scoreKeyForMapSeat(game.playerMap, seat);
}

function seatOfUser(game: OnlineGameState, userId: string): number | null {
  return seatOfUserInMap(game.playerMap, userId);
}

/**
 * Safety valve: the exchange winner holds no card they are allowed to give
 * back. Nobody — human or bot — can satisfy the phase, so it is closed and the
 * hand continues. Without this the whole table sits behind the exchange
 * overlay forever.
 */
function resolveStuckExchange(state: GameState): GameState {
  const next = deepCloneState(state);
  if (next.exchangePhase) next.exchangePhase.active = false;
  next.currentTurnIndex = getStartingPlayerAfterExchange(state);
  next.lastPlayedBy = next.currentTurnIndex;
  return next;
}

/**
 * Achievement bookkeeping: the engine has no notion of "did this
 * seat play a bomb/joker this hand", so every path that actually plays a
 * combination — the human game:play handler and this module's own
 * bot/AFK-forced auto-play — has to update it here, or a forced move (most
 * commonly an AFK-forced lone joker) silently under-counts the purist /
 * iron_will / wild_card achievements.
 */
function recordPlayFlags(game: OnlineGameState, seat: number, combo: Combination) {
  const flags = (game.handFlags[seat] ??= { bomb: false, joker: false });
  if (combo.type === "bomb") flags.bomb = true;
  if (combo.cards.some((c) => c.isJoker)) flags.joker = true;
}

/**
 * One automated action for a seat.
 *
 * `useAi` picks the real engine AI (a seat abandoned by its player), otherwise
 * the minimum legal move (an AFK human, who should not be played well on their
 * behalf). Returns the new state, or null when the seat cannot act at all.
 */
function autoMoveForSeat(
  game: OnlineGameState,
  seat: number,
  useAi: boolean
): GameState | null {
  const state = game.gameState;

  if (state.exchangePhase?.active) {
    if (state.exchangePhase.winnerIdx !== seat) return null;
    const player = state.players[seat];
    if (!player) return null;
    const valid = getValidGivebackCards(player.hand, state.exchangePhase.cardFromLoser?.id);
    if (valid.length === 0) return resolveStuckExchange(state);
    return processExchangeChoice(state, valid[0].id);
  }

  if (state.currentTurnIndex !== seat) return null;
  const player = state.players[seat];
  if (!player || player.hand.length === 0) return null;

  const isNewRound = state.lastPlayedCombination === null;
  // The start card is only mandatory for the very first play of the hand.
  const requireCard = !state.firstPlayMade ? state.startCard : undefined;

  /** Records the move for the replay log and hands back the state it produced. */
  const logged = (combo: Combination | null, next: GameState): GameState => {
    appendReplayMove(game, seat, combo, next);
    return next;
  };

  if (useAi) {
    const otherCounts = state.players
      .filter((_, i) => i !== seat)
      .map((p) => p.hand.length);
    const combo = aiChoosePlay(
      player,
      isNewRound ? null : state.lastPlayedCombination,
      isNewRound,
      otherCounts.length > 0 ? otherCounts : [0],
      requireCard
    );
    if (combo) {
      recordPlayFlags(game, seat, combo);
      return logged(combo, processPlay(state, combo));
    }
    if (!isNewRound) return logged(null, processPass(state));
    // A new round cannot be passed — fall through to the forced minimum play.
  }

  if (isNewRound) {
    // Read the mandatory opening card from the state instead of assuming 3♠:
    // with the full deal it is always present, but it is not always a spade 3.
    const forced = requireCard
      ? player.hand.find((c) => c.id === requireCard.id)
      : undefined;
    const card = forced ?? sortHand([...player.hand])[0];
    if (!card) return null;
    const combo = buildCombination([card]);
    if (!combo) return null;
    recordPlayFlags(game, seat, combo);
    return logged(combo, processPlay(state, combo));
  }

  return logged(null, processPass(state));
}

/**
 * Runs a timer body under the same contract `onEvent` gives an inbound event: a
 * throw degrades to a closed table rather than escaping the callback.
 *
 * The containment is load-bearing rather than tidy. `armTurn` clears the room's
 * timers before it arms the next one, and it is only ever reached from a move, a
 * rejoin, a disconnect or another timer — so a throw inside a timer body leaves
 * the room with nothing pending and nothing that will ever re-arm it. The table
 * stops on a turn that cannot be taken, and the client's clock has no `onExpire`
 * to notice. Closing the table loudly is the recoverable outcome.
 */
function safeTimer(label: string, roomId: string, fn: () => void): void {
  try {
    fn();
  } catch (err) {
    logger.error({ err, roomId, label }, "Timer callback threw — closing table");
    _io?.to(roomId).emit("game:notification", {
      type: "abandoned",
      code: "GAME_INTERRUPTED_SERVER_ERROR",
      message: "Partita interrotta: errore del server.",
    });
    void storage
      .updateRoomStatus(roomId, "finished")
      .catch((statusErr) =>
        logger.warn(
          { err: statusErr, roomId, label },
          "Failed to set rooms.status = finished after a timer callback threw"
        )
      );
    disposeGame(roomId);
  }
}

/** Whole seconds left on a deadline, floored at 0. Zero when nothing is armed. */
function secondsUntil(deadlineMs: number | undefined): number {
  if (deadlineMs === undefined) return 0;
  return Math.max(0, Math.ceil((deadlineMs - Date.now()) / 1000));
}

/**
 * Tells the table how long the acting seat has left. Sent on its own as well
 * as with the state, because the AFK window is re-armed on paths that change
 * no state at all — every rejoin and every disconnect — and a clock that ran
 * to zero while the server still held a full window reads as a frozen table.
 */
function emitTurnDeadline(roomId: string, game: OnlineGameState) {
  _io?.to(roomId).emit("game:turn_deadline", {
    turnDeadlineMs: game.turnDeadlineMs,
    turnSecondsRemaining: secondsUntil(game.turnDeadlineMs),
  });
}

/**
 * Single scheduler for "whose move is it". Called after every state change, so
 * the AFK chain never breaks and a vacated seat is always resolvable:
 *   seat has a user  -> arm that user's AFK timer
 *   seat is vacant   -> a bot plays it after a short delay
 */
function armTurn(roomId: string) {
  const io = _io;
  const game = activeGames.get(roomId);
  if (!io || !game) return;

  clearRoomTimers(roomId);
  if (game.gameState.gameOver) {
    game.turnDeadlineMs = undefined;
    return;
  }

  const seat = actingSeat(game.gameState);
  const userId = game.playerMap[seat];

  if (userId === undefined) {
    game.turnDeadlineMs = undefined;
    botTimers.set(
      roomId,
      setTimeout(() => {
        botTimers.delete(roomId);
        safeTimer("botTurn", roomId, () => runBotTurn(roomId));
      }, BOT_MOVE_DELAY_MS)
    );
    emitTurnDeadline(roomId, game);
    return;
  }

  const username = game.gameState.players[seat]?.name ?? "";
  game.turnDeadlineMs = Date.now() + AFK_TIMEOUT_MS;
  startAfkTimer(roomId, userId, username);
  emitTurnDeadline(roomId, game);
}

/**
 * Arms the room's turn scheduler only if nothing is already pending for the
 * seat that has to act. For the rejoin paths, which must not disturb a clock
 * that is already running: `armTurn` clears the room's timers before it arms,
 * so calling it on every rejoin hands the acting seat a fresh full AFK window
 * each time — a seated player could then hold the table open indefinitely on
 * their own turn by rejoining in a loop.
 *
 * A table with no pending timer is armed unconditionally, which is what the
 * game rehydrated from the database after a restart needs: it has no timers at
 * all, and nothing else would ever arm one.
 */
function armTurnIfIdle(roomId: string) {
  const game = activeGames.get(roomId);
  if (!game) return;

  if (botTimers.has(roomId)) return emitTurnDeadline(roomId, game);
  const seatUserId = game.playerMap[actingSeat(game.gameState)];
  if (seatUserId !== undefined && afkTimers.has(`${roomId}:${seatUserId}`)) {
    return emitTurnDeadline(roomId, game);
  }

  armTurn(roomId);
}

function runBotTurn(roomId: string) {
  const io = _io;
  const game = activeGames.get(roomId);
  if (!io || !game || game.gameState.gameOver) return;

  const seat = actingSeat(game.gameState);
  if (game.playerMap[seat] !== undefined) {
    // The seat was reclaimed while the timer was pending.
    armTurn(roomId);
    return;
  }

  const next = autoMoveForSeat(game, seat, true);
  if (!next) {
    logger.error({ roomId, seat }, "Vacant seat could not act — closing table");
    io.to(roomId).emit("game:notification", {
      type: "abandoned",
      code: "GAME_INTERRUPTED_EMPTY_SEAT",
      message: "Match interrupted: an empty seat cannot play.",
    });
    void storage
      .updateRoomStatus(roomId, "finished")
      .catch((err) =>
        logger.warn(
          { err, roomId, seat },
          "Failed to set rooms.status = finished after closing a table with an unplayable empty seat"
        )
      );
    disposeGame(roomId);
    return;
  }

  game.gameState = next;
  broadcastGameState(io, game);
  persistGameState(roomId, game);

  if (next.gameOver) {
    void handleGameOver(io, roomId, game);
  } else {
    armTurn(roomId);
  }
}

/** What the seat was made to do, or null when nothing was played. */
function handleAutoPass(roomId: string, userId: string): "exchange" | "move" | null {
  const io = _io;
  const game = activeGames.get(roomId);
  if (!io || !game || game.gameState.gameOver) return null;

  const seat = actingSeat(game.gameState);
  if (game.playerMap[seat] !== userId) return null;

  const wasExchange = !!game.gameState.exchangePhase?.active;
  const next = autoMoveForSeat(game, seat, false);
  if (!next) return null;

  game.gameState = next;
  broadcastGameState(io, game);
  persistGameState(roomId, game);

  if (next.gameOver) {
    void handleGameOver(io, roomId, game);
  } else {
    armTurn(roomId);
  }
  return wasExchange ? "exchange" : "move";
}

function startAfkTimer(roomId: string, userId: string, username: string) {
  clearAfkTimer(roomId, userId);
  const key = `${roomId}:${userId}`;
  afkTimers.set(
    key,
    setTimeout(() => {
      afkTimers.delete(key);
      safeTimer("afkAutoPass", roomId, () => {
        const acted = handleAutoPass(roomId, userId);
        // Only announce when something actually happened, not on an early
        // return that did nothing.
        if (acted && _io) {
          const exchanged = acted === "exchange";
          _io.to(roomId).emit("game:notification", {
            type: "afk",
            code: exchanged ? "PLAYER_AFK_AUTO_EXCHANGE" : "PLAYER_AFK_AUTO_PASS",
            message: exchanged
              ? `${username} è inattivo — carta scambiata automaticamente`
              : `${username} è inattivo — passato automaticamente`,
            params: { username },
          });
        }
      });
    }, AFK_TIMEOUT_MS)
  );
}

// ─── Seat vacancy ─────────────────────────────────────────────────────────────

/**
 * Ends a hand nobody is left to play: `winnerSeat` takes it, and every seat
 * still holding cards is placed behind them — closest to finishing first, seat
 * order as a stable tiebreak, the same ordering the engine uses when a hand
 * ends with cards still out.
 *
 * Every seat must reach `rankings`: it is what the scoreboard awards from and
 * what the stats writer reads a result from, so a seat missing from it played
 * no game at all. Seats that already emptied their hand keep the position they
 * earned.
 */
function concedeHand(game: OnlineGameState, winnerSeat: number | undefined) {
  const state = game.gameState;
  const place = (seat: number) => {
    const player = state.players[seat];
    if (!player || player.finishPosition !== undefined) return;
    player.finishPosition = state.rankings.length + 1;
    state.rankings.push(player.id);
  };

  if (winnerSeat !== undefined) place(winnerSeat);
  state.players
    .map((player, seat) => ({ player, seat }))
    .filter(({ player }) => player.finishPosition === undefined)
    .sort((a, b) => a.player.hand.length - b.player.hand.length || a.seat - b.seat)
    .forEach(({ seat }) => place(seat));

  state.gameOver = true;
}

/**
 * Frees a seat whose player is gone for good — grace period expired, or an
 * explicit leave, either mid-hand or at the results screen — and hands it to a
 * bot. The hand stays in play, so the table can always continue: the seat must
 * be removed from `playerMap` *and* marked AI-controlled together, or the table
 * deadlocks as soon as the turn comes round to it.
 */
async function vacateSeat(
  io: SocketServer,
  roomId: string,
  userId: string,
  username: string
) {
  const game = activeGames.get(roomId);
  if (!game) return;

  game.rematchVotes.delete(userId);
  const seat = seatOfUser(game, userId);
  if (seat === null) return;

  delete game.playerMap[seat];
  clearAfkTimer(roomId, userId);

  const seatPlayer = game.gameState.players[seat];
  if (seatPlayer) seatPlayer.type = "ai";

  // Walking out on a hand still holding cards is a forfeit, and is recorded as
  // one at game over. A seat between hands has no hand to forfeit, and a seat
  // that already emptied its hand has finished the one it was playing.
  if (!game.gameState.gameOver && seatPlayer?.finishPosition === undefined) {
    game.abandonedSeats.set(seat, userId);
  }

  const remaining = Object.keys(game.playerMap).length;

  if (game.gameState.gameOver) {
    // Between hands the table is not interrupted — it is waiting to deal
    // again — so the leaver simply stops counting towards the rematch vote.
    // This must NOT be `game:player_left`: that event drives the client's
    // "Partita interrotta" teardown, which would eject everyone still sitting
    // at a table the server is about to restart.
    io.to(roomId).emit("game:seat_bot_takeover", {
      userId,
      username,
      seatIndex: seat,
      code: "PLAYER_LEFT_BOT_TAKEOVER",
      message: `${username} ha lasciato la partita — il computer gioca al suo posto.`,
      params: { username },
    });
    // `total` is the seated-seat count, which is what the `game:rematch_vote`
    // gate compares `rematchVotes.size` against.
    io.to(roomId).emit("game:vote_state", {
      votes: Array.from(game.rematchVotes),
      total: remaining,
    });
    if (remaining === 0) {
      await storage
        .updateRoomStatus(roomId, "finished")
        .catch((err) =>
          logger.warn(
            { err, roomId, userId, seat },
            "Failed to set rooms.status = finished after the last player left between hands"
          )
        );
      disposeGame(roomId);
    }
    return;
  }

  if (remaining <= 1) {
    // Genuinely unplayable: no live player left to continue against.
    io.to(roomId).emit("game:player_left", { userId, username, seatIndex: seat });
    io.to(roomId).emit("game:notification", {
      type: "abandoned",
      code: "PLAYER_LEFT_ABANDONED",
      message: `${username} ha lasciato la partita.`,
      params: { username },
    });
    // The hand is scored rather than discarded. The win goes to the last seat
    // still held by a person; concedeHand places every seat still holding
    // cards behind them, the walkout included as the last-place finish a
    // forfeit is. `survivorSeat` is undefined when the departing seat was the
    // only human — the remaining bots then place among themselves, and
    // isContestedTable drops every write for such a table anyway.
    const survivorSeat = Object.keys(game.playerMap).map(Number)[0];
    concedeHand(game, survivorSeat);
    // Sets rooms.status = "finished" and writes the row itself; the write is
    // awaited so the disposal below deletes a row that already exists.
    await handleGameOver(io, roomId, game);
    disposeGame(roomId);
    return;
  }

  // The table survives with a bot in this seat — everyone else keeps
  // playing. This must NOT be `game:player_left`: that event drives the
  // client's "Partita interrotta" teardown, which would eject every
  // remaining human from a game the server is still keeping alive.
  io.to(roomId).emit("game:seat_bot_takeover", {
    userId,
    username,
    seatIndex: seat,
    code: "PLAYER_LEFT_BOT_TAKEOVER",
    message: `${username} ha lasciato la partita — il computer gioca al suo posto.`,
    params: { username },
  });

  broadcastGameState(io, game);
  persistGameState(roomId, game);
  armTurn(roomId);
}

// ─── Match scoring ────────────────────────────────────────────────────────────

async function handleGameOver(
  io: SocketServer,
  roomId: string,
  game: OnlineGameState
) {
  const state = game.gameState;
  clearRoomTimers(roomId);
  // A pending grace timer must not fire into a finished game and evict the
  // survivors from the rematch screen.
  clearRoomDisconnectTimers(game);

  const result = resolveHandEnd({
    state,
    playerMap: game.playerMap,
    cumulativeScores: game.cumulativeScores,
    matchTarget: game.matchTarget,
    matchLength: game.matchLength,
    gameMode: game.gameMode,
    handFlags: game.handFlags,
    abandonedSeats: game.abandonedSeats,
  });
  const { handByKey, matchWinners, isDraw, detailed, byName, winnerNames } = result;
  game.cumulativeScores = result.cumulativeScores;
  game.matchTarget = result.matchTarget;
  game.matchOver = result.matchOver;

  const matchContinues = game.matchOver ? tableWantsRematch(game) : false;

  game.rematchVotes = new Set();

  io.to(roomId).emit("game:over", {
    rankings: state.rankings,
    cumulativeScores: byName,
    scores: detailed,
    matchTarget: game.matchTarget,
    matchLength: game.matchLength,
    matchOver: game.matchOver,
    matchWinners: winnerNames,
    matchContinues,
    isDraw,
  });

  if (game.matchOver) {
    io.to(roomId).emit("game:match_over", {
      target: game.matchTarget,
      isDraw,
      winners: winnerNames,
      continues: matchContinues,
    });
  }

  // The one record of how a hand resolved. `match_replays` is not a substitute:
  // it is written only for a table with a human seat and a live moveLog, and it
  // stores no scores. Ids and integers only — never hand contents.
  logger.info(
    {
      roomId,
      gameMode: game.gameMode,
      matchLength: game.matchLength,
      rankings: state.rankings,
      handByKey,
      cumulative: game.cumulativeScores,
      matchTarget: game.matchTarget,
      matchOver: game.matchOver,
      isDraw,
      matchWinners,
    },
    "Hand over"
  );

  await storage
    .updateRoomStatus(roomId, "finished")
    .catch((err) =>
      logger.warn(
        { err, roomId },
        "Failed to set rooms.status = finished after the hand ended"
      )
    );
  // The row is kept (not deleted) so a restart between hands restores the
  // running match instead of silently resetting the scoreboard. Awaited so a
  // caller that disposes the table straight after cannot delete the row
  // before this write lands on it.
  await persistGameState(roomId, game);

  // ── Stats / history / achievements ────────────────────────────────────────
  //
  // Deliberately placed after every broadcast/persist above, not before: the
  // game-over guarantee is "a stats write must never block or fail the
  // game", and handleGameOver is itself async with two call sites that
  // invoke it as bare `void` (see runBotTurn / the game:play handler). The
  // shaping itself already happened, purely, in resolveHandEnd — this block
  // is only the (fire-and-forget) writes, still guarded so a throw here
  // cannot reject handleGameOver's own promise.
  try {
    const { gameResults, recordable } = result;
    if (!recordable) {
      logger.info(
        { roomId },
        "Bot-majority table — stats, history and achievements not recorded"
      );
    } else {
      // Deliberately not awaited: a stats write must never be able to block
      // or delay whatever runs after handleGameOver at any of its call sites.
      recordGameResult(gameResults, game.gameMode).catch((err) =>
        logger.error({ err, roomId }, "Failed to record game results")
      );
      // The ladder moves on the same gate as stats: a bot-majority table
      // awards nothing, or a private room of bots would be free rating.
      // recordRatedResult declines a teams result on its own (placement
      // belongs to the pair, not to either partner).
      recordRatedResult(gameResults, game.gameMode, new Date()).catch((err) =>
        logger.error({ err, roomId }, "Failed to record rated result")
      );
    }

    // A replay is written for any table with a human seat, bot-majority ones
    // included: it records what happened, it awards nothing. Not awaited, and
    // the table is not required to exist — until `db:push` has run the insert
    // fails, is logged, and the only consequence is an empty replays list.
    if (game.moveLog && game.moveLog.length > 0) {
      saveReplay({
        roomCode: roomId,
        gameMode: game.gameMode,
        seats: replaySeatsOf(state.players, game.playerMap),
        moves: game.moveLog,
        rankings: state.rankings,
      }).catch((err) => logger.error({ err, roomId }, "Failed to save replay"));
    }
  } catch (err) {
    // Belt-and-braces: even the synchronous work above must not be able to
    // throw back into handleGameOver's own promise (see the comment above
    // this block).
    logger.error({ err, roomId }, "Failed to schedule stats/ratings/replay writes");
  }
}

/** Between hands: a finished match starts over, an unfinished one carries on. */
function rollMatchForward(game: OnlineGameState) {
  if (game.matchOver) {
    game.cumulativeScores = {};
    game.matchTarget = targetsFor(game.gameState.players.length)[0];
    game.matchOver = false;
    game.rematchIntents.clear();
  }
}

/**
 * How many seats want another match, and how many seats there are. A seat
 * with no playerMap entry — a bot, or a human's seat after they left — has
 * no one who can answer, so it abstains: it counts toward neither yes nor
 * total. A seated human who never answered counts as a no, but still counts
 * toward total.
 */
function countRematchAnswers(game: OnlineGameState): { yes: number; total: number } {
  const seats = game.gameState.players.length;
  let yes = 0;
  let total = 0;
  for (let seat = 0; seat < seats; seat++) {
    const userId = game.playerMap[seat];
    if (userId === undefined) continue;
    total++;
    if (game.rematchIntents.get(userId) === true) yes++;
  }
  return { yes, total };
}

/**
 * Cumulative match points keyed by display name — the one wire shape clients
 * read, matching what `game:over` ships.
 */
function scoresByName(game: OnlineGameState): Record<string, number> {
  const byName: Record<string, number> = {};
  game.gameState.players.forEach((p, seat) => {
    byName[p.name] = game.cumulativeScores[scoreKeyForSeat(game, seat)] ?? 0;
  });
  return byName;
}

function tableWantsRematch(game: OnlineGameState): boolean {
  const { yes, total } = countRematchAnswers(game);
  return isMajority(yes, total);
}

function broadcastRematchIntents(io: SocketServer, game: OnlineGameState) {
  const { yes, total } = countRematchAnswers(game);
  io.to(game.roomId).emit("game:rematch_intents", {
    yes,
    total,
    answers: Object.fromEntries(game.rematchIntents),
  });
}

// ─── Server ───────────────────────────────────────────────────────────────────

export function setupSocket(httpServer: HttpServer) {
  const io = new SocketServer(httpServer, {
    cors: {
      // Mirrors the Express allowlist. `origin: "*"` with credentials is both
      // invalid and permissive.
      origin: (origin, callback) => {
        callback(null, isAllowedOrigin(origin));
      },
      methods: ["GET", "POST"],
      credentials: true,
    },
    transports: ["websocket", "polling"],
    maxHttpBufferSize: 1e5,
  });
  _io = io;

  // Inject session into socket requests
  io.use((socket, next) => {
    sessionMiddleware(socket.request as any, {} as any, next as any);
  });

  /**
   * Handshake auth: a valid session, or a valid unconsumed ticket. Nothing
   * else — accepting a bare `handshake.auth.userId` would let any client
   * connect as any user.
   */
  io.use(async (socket, next) => {
    try {
      const req = socket.request as any;
      const sessionUserId = req.session?.userId as string | undefined;
      const claimedUserId =
        sessionUserId ?? consumeSocketTicket(socket.handshake.auth?.ticket);

      if (!claimedUserId) return next(new Error("Not authenticated"));

      // The session or the ticket has already proved this id, so the budget is
      // keyed on it and spent *before* the account's first query rather than
      // after it — the queries are what the limit exists to bound.
      socket.data.userId = claimedUserId;
      if (
        !allowSocketAction(
          socket,
          "connection",
          HANDSHAKES_PER_MINUTE,
          HANDSHAKE_WINDOW_MS
        )
      ) {
        logger.warn({ userId: claimedUserId }, "Handshake refused — too many connections");
        return next(new Error("Too many connections"));
      }

      const user = await storage.getUser(claimedUserId).catch(() => null);
      if (!user) return next(new Error("Not authenticated"));

      socket.data.username = user.username;
      return next();
    } catch (err) {
      logger.error({ err }, "Socket handshake failed");
      return next(new Error("Not authenticated"));
    }
  });

  io.on("connection", async (socket: Socket) => {
    const userId = socket.data.userId as string;
    const username = socket.data.username as string;
    // The mapping has to name the new socket before the old one is closed —
    // see evictReplacedSession for what reads it on the way out.
    const replacedSocketId = userSocketMap.get(userId);
    userSocketMap.set(userId, socket.id);
    if (replacedSocketId && replacedSocketId !== socket.id) {
      evictReplacedSession(io, userId, replacedSocketId, socket);
    }
    logger.debug({ userId, username, socketId: socket.id }, "Socket connected");

    // Every onEvent(...)/socket.on(...) registration below is synchronous and
    // must run before this function's first `await`. Socket.io starts
    // delivering client packets the instant the transport is up — a client
    // that emits on its own "connect" handler (the app's actual reconnect
    // path: OnlineGameContext fires game:rejoin from there) can beat an
    // `await` placed ahead of these registrations, and a packet that arrives
    // with no listener attached is silently dropped: no error, no ack, the
    // player just never hears back. The reconnect-notice and friends-list
    // work below genuinely needs to await the database, so it runs after
    // instead, once every listener already exists.

    // ── Room events ──────────────────────────────────────────────────────────

    onEvent(
      socket,
      "room:create",
      RoomCreateSchema,
      async ({ gameMode, maxPlayers }) => {
        if (gameMode === "teams" && maxPlayers !== TEAMS_PLAYER_COUNT) {
          socket.emit("room:error", {
            message: "Teams mode needs exactly 4 players",
            code: "TEAMS_REQUIRE_FOUR",
          });
          return;
        }
        const room = await storage.createRoom(userId, gameMode, maxPlayers);
        await storage.addRoomPlayer(room.id, userId, 0);

        socket.join(room.id);
        socketRoomMap.set(socket.id, room.id);

        const players = await storage.getRoomPlayers(room.id);
        socket.emit("room:state", roomStatePayload(room, players));
        logger.info({ roomId: room.id, code: room.code, userId }, "Room created");
      },
      { limit: 5, windowMs: 60_000 }
    );

    // ── Spectating ────────────────────────────────────────────────────────
    //
    // A spectator is a viewer with no seat. sanitizeStateForPlayer blanks the
    // hand of every seat that is not the viewer's, so a seatless viewer sees
    // no cards at all — there is no spectator-specific sanitiser to get wrong.
    // For the same reason a spectator cannot act: every game handler resolves
    // the actor by seat and returns when it does not match.
    onEvent(
      socket,
      "room:spectate",
      RoomSpectateSchema,
      async ({ code }) => {
        const room = await storage.getRoomByCode(code.toUpperCase());
        if (!room) {
          socket.emit("room:error", { message: "Room not found", code: "ROOM_NOT_FOUND" });
          return;
        }
        const game = activeGames.get(room.id);
        if (!game || game.gameState.gameOver) {
          socket.emit("room:error", { message: "Game not found", code: "GAME_NOT_FOUND" });
          return;
        }
        // A seated player watching their own table would be handed the
        // seatless view and lose sight of their own hand.
        if (seatOfUser(game, userId) !== null) {
          socket.emit("room:error", { message: "You are already at the table", code: "ALREADY_IN_ROOM" });
          return;
        }

        const previous = spectatorRoomMap.get(socket.id);
        if (previous && previous !== room.id) {
          activeGames.get(previous)?.spectators.delete(userId);
          socket.leave(previous);
        }
        game.spectators.add(userId);
        spectatorRoomMap.set(socket.id, room.id);
        socket.join(room.id);
        socket.emit(
          "game:state",
          sanitizeStateForPlayer(game.gameState, userId, game.playerMap, game.turnDeadlineMs)
        );
        logger.info({ roomId: room.id, userId }, "Spectator joined");
      },
      { limit: 10, windowMs: 60_000 }
    );

    // Through onEvent like every other inbound event, not a bare socket.on.
    // It carries no payload, so validation is moot, but the rate limit and the
    // per-event error containment are not — and an event registered outside
    // the wrapper is exactly the one nobody remembers to check.
    onEvent(
      socket,
      "room:unspectate",
      NoPayloadSchema,
      () => {
        const roomId = spectatorRoomMap.get(socket.id);
        if (!roomId) return;
        activeGames.get(roomId)?.spectators.delete(userId);
        spectatorRoomMap.delete(socket.id);
        socket.leave(roomId);
      },
      // Matches room:spectate: leaving cannot be cheaper to spam than joining.
      { limit: 10, windowMs: 60_000 }
    );

    onEvent(
      socket,
      "room:join",
      RoomJoinSchema,
      async ({ code }) => {
        const room = await storage.getRoomByCode(code.toUpperCase());
        if (!room) {
          socket.emit("room:error", { message: "Room not found", code: "ROOM_NOT_FOUND" });
          return;
        }
        if (room.status !== "waiting") {
          socket.emit("room:error", { message: "Game already started", code: "GAME_ALREADY_STARTED" });
          return;
        }

        const claim = await storage.claimRoomSeat(room.id, userId);
        if (!claim.ok) {
          socket.emit("room:error", {
            message: seatClaimMessage(claim.reason),
            code: seatClaimCode(claim.reason),
          });
          return;
        }

        socket.join(room.id);
        socketRoomMap.set(socket.id, room.id);

        const updatedPlayers = await storage.getRoomPlayers(room.id);
        io.to(room.id).emit("room:state", roomStatePayload(room, updatedPlayers));
      },
      { limit: 10, windowMs: 60_000 }
    );

    /**
     * Coming back to a waiting lobby on a new socket. A lobby disconnect frees
     * the seat straight away (handleSeatRelease), so there is nothing to hold
     * open and nothing to restore beyond taking the seat again and re-attaching
     * the socket; the claim answers with the same rejections room:join does,
     * and `already_joined` is the good case — the row outlived the drop.
     *
     * This event is only for a caller who was in the room: a seat row that
     * survived, or a `lobbyDropouts` record of the drop. Anyone else holding
     * the code is joining, and `room:join` is the event that seats them.
     *
     * The host role goes back to the account that lost it on the way out and
     * to nobody else, so the migration handleSeatRelease made is undone rather
     * than handed to whoever reaches the lowest seat first.
     *
     * Without this the returning socket has no socketRoomMap entry, so every
     * later room event resolves to no room and returns silently — the host's
     * start button becomes a dead control and a guest waits on a roster the
     * server no longer lists them in.
     */
    onEvent(
      socket,
      "room:rejoin",
      RoomRejoinSchema,
      async ({ code }) => {
        const room = await storage.getRoomByCode(code.toUpperCase());
        if (!room) {
          socket.emit("room:error", { message: "Room not found", code: "ROOM_NOT_FOUND" });
          return;
        }

        const seated = await storage.getRoomPlayers(room.id);
        const wasHost = lobbyDropouts.get(room.id)?.get(userId);
        if (wasHost === undefined && !seated.some((p) => p.userId === userId)) {
          socket.emit("room:error", {
            message: "You are not in this room",
            code: "NOT_IN_ROOM",
          });
          return;
        }

        const claim = await storage.claimRoomSeat(room.id, userId);
        if (!claim.ok && claim.reason !== "already_joined") {
          socket.emit("room:error", {
            message: seatClaimMessage(claim.reason),
            code: seatClaimCode(claim.reason),
          });
          return;
        }

        socket.join(room.id);
        socketRoomMap.set(socket.id, room.id);
        forgetLobbyDropout(room.id, userId);

        const players = await storage.getRoomPlayers(room.id);
        let hostUserId = room.hostUserId;
        if (wasHost && hostUserId !== userId) {
          hostUserId = userId;
          await storage.updateRoomHost(room.id, hostUserId);
        }
        io.to(room.id).emit(
          "room:state",
          roomStatePayload({ ...room, hostUserId }, players)
        );
      },
      { limit: 20, windowMs: 60_000 }
    );

    onEvent(
      socket,
      "room:leave",
      NoPayloadSchema,
      async () => {
        const leavingRoomId = socketRoomMap.get(socket.id);
        if (!leavingRoomId) return;
        socketRoomMap.delete(socket.id);

        await handleSeatRelease(
          io,
          leavingRoomId,
          userId,
          socket.data?.username ?? username,
          { socket, source: "leave" }
        );
        // Needs the player count as it stands after the removal, which is why
        // it is here rather than inside handleSeatRelease.
        if (publicRoomIds.has(leavingRoomId)) {
          const remaining = await storage.getRoomPlayers(leavingRoomId);
          if (remaining.length === 0) publicRoomIds.delete(leavingRoomId);
        }
      },
      { limit: 20, windowMs: 60_000 }
    );

    onEvent(
      socket,
      "room:quickmatch",
      RoomQuickmatchSchema,
      async ({ maxPlayers, gameMode }) => {
        if (gameMode === "teams" && maxPlayers !== TEAMS_PLAYER_COUNT) {
          socket.emit("room:error", {
            message: "Teams mode needs exactly 4 players",
            code: "TEAMS_REQUIRE_FOUR",
          });
          return;
        }
        // One query for the whole candidate set instead of two per room.
        const waiting = await storage.getWaitingRooms(
          Array.from(publicRoomIds),
          userId
        );
        const stillWaiting = new Set(waiting.map((c) => c.room.id));
        for (const roomId of Array.from(publicRoomIds)) {
          if (!stillWaiting.has(roomId)) publicRoomIds.delete(roomId);
        }

        let joinedRoomId: string | null = null;
        for (const candidate of waiting) {
          if (candidate.containsUser) continue;
          if (
            candidate.room.maxPlayers !== maxPlayers ||
            candidate.room.gameMode !== gameMode
          )
            continue;
          if (candidate.playerCount >= candidate.room.maxPlayers) {
            publicRoomIds.delete(candidate.room.id);
            continue;
          }
          const claim = await storage.claimRoomSeat(candidate.room.id, userId);
          if (!claim.ok) {
            if (claim.reason === "full" || claim.reason === "not_waiting") {
              publicRoomIds.delete(candidate.room.id);
            }
            continue;
          }

          const roomId = candidate.room.id;
          socket.join(roomId);
          socketRoomMap.set(socket.id, roomId);

          const updatedPlayers = await storage.getRoomPlayers(roomId);
          io.to(roomId).emit(
            "room:state",
            roomStatePayload(candidate.room, updatedPlayers)
          );
          if (updatedPlayers.length >= candidate.room.maxPlayers) {
            publicRoomIds.delete(roomId);
          }
          joinedRoomId = roomId;
          break;
        }

        if (!joinedRoomId) {
          const room = await storage.createRoom(userId, gameMode, maxPlayers);
          await storage.addRoomPlayer(room.id, userId, 0);
          publicRoomIds.add(room.id);
          socket.join(room.id);
          socketRoomMap.set(socket.id, room.id);

          const players = await storage.getRoomPlayers(room.id);
          socket.emit("room:state", roomStatePayload(room, players));
        }
      },
      { limit: 10, windowMs: 60_000 }
    );

    onEvent(
      socket,
      "room:set_game_mode",
      RoomSetGameModeSchema,
      async ({ gameMode }) => {
        const roomId = socketRoomMap.get(socket.id);
        if (!roomId) return;
        const room = await storage.getRoomById(roomId);
        if (!room || room.hostUserId !== userId) return;
        // The host could otherwise flip a running game between free-for-all
        // and teams.
        if (room.status !== "waiting") {
          socket.emit("room:error", {
            message: "Cannot change mode once the game has started",
            code: "CANNOT_CHANGE_MODE_IN_PROGRESS",
          });
          return;
        }
        if (gameMode === "teams" && room.maxPlayers !== TEAMS_PLAYER_COUNT) {
          socket.emit("room:error", {
            message: "Teams mode needs exactly 4 players",
            code: "TEAMS_REQUIRE_FOUR",
          });
          return;
        }
        await storage.updateRoomGameMode(roomId, gameMode);
        const players = await storage.getRoomPlayers(roomId);
        const updatedRoom = await storage.getRoomById(roomId);
        if (!updatedRoom) return;
        io.to(roomId).emit("room:state", roomStatePayload(updatedRoom, players));
      },
      { limit: 20, windowMs: 60_000 }
    );

    onEvent(
      socket,
      "room:start",
      RoomStartSchema,
      async ({ fillWithBots, botPersonality, matchLength }) => {
        const roomId = socketRoomMap.get(socket.id);
        if (!roomId) return;
        const room = await storage.getRoomById(roomId);
        if (!room || room.hostUserId !== userId) return;

        // A live in-memory game is the authority on whether this room may
        // deal: `rooms.status` reads "finished" between the manches of a
        // running match as well as after the last one, and it is written a
        // moment *after* game:over reaches the clients, so it is stale exactly
        // when a between-hands start arrives.
        const previous = activeGames.get(roomId);

        if (previous) {
          if (!previous.matchOver) {
            // The next manche of a running match is game:rematch_vote's job.
            // Dealing it here would deal without an exchange phase, and would
            // let the payload's matchLength rewrite the format of a match
            // that is already being scored.
            socket.emit("room:error", {
              message: "A match is already in progress",
              code: "MATCH_IN_PROGRESS",
            });
            return;
          }

          // A finished match releases every player's commitment, so the next
          // one is a new agreement: it needs the whole table ready, not the
          // host alone. Same ready set as game:rematch_vote, and the same
          // abstention — a seat with no playerMap entry (a bot, or a human
          // who left) has nobody who can answer and is not counted.
          if (seatOfUser(previous, userId) !== null) {
            previous.rematchVotes.add(userId);
          }
          const seated = Object.values(previous.playerMap);
          io.to(roomId).emit("game:vote_state", {
            votes: Array.from(previous.rematchVotes),
            total: seated.length,
          });
          if (!seated.every((uid) => previous.rematchVotes.has(uid))) {
            socket.emit("room:error", {
              message: "Every player must be ready before a new match starts",
              code: "NEW_MATCH_NOT_READY",
            });
            return;
          }
        } else if (room.status !== "waiting" && room.status !== "finished") {
          // No game in memory: the room row is all there is, and a room
          // mid-game there is one a restart stranded, not one to deal into.
          return;
        }

        const players = await storage.getRoomPlayers(room.id);
        // With bots filling every empty seat, one seated human is enough —
        // the min-2 guard only matters for an all-human table.
        if (!fillWithBots && players.length < 2) {
          socket.emit("room:error", { message: "At least 2 players are required", code: "MIN_PLAYERS_REQUIRED" });
          return;
        }
        if (players.length < 1) return;

        clearRoomTimers(roomId);

        const humans = players.map((p) => ({
          seatIndex: p.seatIndex,
          userId: p.userId,
          username: p.user.username,
        }));
        // Engine seat index is the position in this roster, sorted by seat.
        // playerMap is keyed the same way, so a gap in the DB seat numbering
        // (or a bot filling that gap) can never shift a hand onto the wrong
        // player. Bot seats are simply left out of playerMap — armTurn/
        // autoMoveForSeat already treat a missing playerMap entry as "drive
        // this seat with the AI", exactly the path a disconnect takeover uses.
        const roster = buildSeatRoster(humans, room.maxPlayers, { fillWithBots, botPersonality });
        if (room.gameMode === "teams" && roster.length !== TEAMS_PLAYER_COUNT) {
          socket.emit("room:error", {
            message: "Teams mode needs exactly 4 players",
            code: "TEAMS_REQUIRE_FOUR",
          });
          return;
        }

        const playerSetup = roster.map((r, idx) => ({
          name: r.username,
          type: (r.isBot ? "ai" : "human") as "human" | "ai",
          personality: r.isBot ? r.personality : undefined,
          team: teamForSeat(idx, roster.length, room.gameMode),
        }));

        const gameState = initializeGame(playerSetup, room.gameMode);
        const playerMap: Record<number, string> = {};
        roster.forEach((r, idx) => {
          if (!r.isBot) playerMap[idx] = r.userId;
        });

        const newGame: OnlineGameState = {
          gameState,
          playerMap,
          roomId,
          rematchVotes: new Set(),
          rematchIntents: new Map(),
          cumulativeScores: previous?.cumulativeScores ?? {},
          gameMode: room.gameMode,
          maxPlayers: room.maxPlayers,
          matchTarget: previous?.matchTarget ?? targetsFor(roster.length)[0],
          matchLength: matchLength ?? previous?.matchLength ?? "match",
          matchOver: previous?.matchOver ?? false,
          handFlags: {},
          abandonedSeats: new Map<number, string>(),
          spectators: new Set<string>(),
          moveLog: startReplayLog(),
          dealFirstSeat: 0,
        };
        rollMatchForward(newGame);
        activeGames.set(roomId, newGame);

        publicRoomIds.delete(roomId);
        // The lobby is over; a seat lost from here on is the live game's to
        // hold open through the disconnect grace.
        lobbyDropouts.delete(roomId);
        await storage.updateRoomStatus(roomId, "in_progress");

        broadcastGameState(io, newGame);
        io.to(roomId).emit("game:started");
        io.to(roomId).emit("game:match_state", {
          target: newGame.matchTarget,
          length: newGame.matchLength,
          scores: scoresByName(newGame),
        });

        persistGameState(roomId, newGame);
        armTurn(roomId);
        logger.info(
          { roomId, playerCount: players.length, botCount: roster.length - players.length },
          "Game started"
        );
      },
      { limit: 10, windowMs: 60_000 }
    );

    // ── Game events ──────────────────────────────────────────────────────────

    onEvent(
      socket,
      "game:play",
      GamePlaySchema,
      async ({ cardIds }) => {
        const roomId = socketRoomMap.get(socket.id);
        if (!roomId) return;
        const game = activeGames.get(roomId);
        if (!game || game.gameState.gameOver) return;

        const { gameState, playerMap } = game;

        // The round winner owes a card: nobody may play until it is given,
        // otherwise they keep the card and freeze the table behind the
        // exchange overlay.
        if (gameState.exchangePhase?.active) {
          socket.emit("game:error", {
            message: "You must complete the exchange first",
            code: "EXCHANGE_PENDING",
          });
          return;
        }

        const currentIdx = gameState.currentTurnIndex;
        if (playerMap[currentIdx] !== userId) return;

        const player = gameState.players[currentIdx];
        if (!player) return;
        const unique = Array.from(new Set(cardIds));
        const cards = player.hand.filter((c) => unique.includes(c.id));
        if (cards.length !== unique.length) return;

        const combo = buildCombination(cards);
        if (!combo) {
          socket.emit("game:error", { message: "Invalid combination", code: "INVALID_COMBINATION" });
          return;
        }

        const isNewRound = gameState.lastPlayedCombination === null;

        if (!gameState.firstPlayMade && gameState.startCard) {
          const startCardId = gameState.startCard.id;
          if (!combo.cards.some((c) => c.id === startCardId)) {
            const sc = gameState.startCard;
            socket.emit("game:error", {
              message: `Devi giocare il ${sc.rank}♠ come prima carta`,
              code: "MUST_PLAY_START_CARD",
              params: { rank: sc.rank },
            });
            return;
          }
        }

        if (!canPlay(combo, isNewRound ? null : gameState.lastPlayedCombination)) {
          socket.emit("game:error", { message: "Invalid move", code: "INVALID_MOVE" });
          return;
        }

        // Achievement bookkeeping — see recordPlayFlags; this is the
        // human-initiated path, autoMoveForSeat covers bot/AFK-forced plays.
        recordPlayFlags(game, currentIdx, combo);

        const newState = processPlay(gameState, combo);
        appendReplayMove(game, currentIdx, combo, newState);
        game.gameState = newState;

        // A count and a type, never card identities: enabling debug in
        // production must not be able to expose a hand.
        logger.debug(
          {
            roomId,
            seat: currentIdx,
            comboType: combo.type,
            cardCount: combo.cards.length,
          },
          "Play accepted"
        );

        broadcastGameState(io, game);
        persistGameState(roomId, game);

        if (newState.gameOver) {
          await handleGameOver(io, roomId, game);
        } else {
          armTurn(roomId);
        }
      },
      { limit: 60, windowMs: 60_000 }
    );

    onEvent(
      socket,
      "game:pass",
      NoPayloadSchema,
      async () => {
        const roomId = socketRoomMap.get(socket.id);
        if (!roomId) return;
        const game = activeGames.get(roomId);
        if (!game || game.gameState.gameOver) return;

        const { gameState, playerMap } = game;
        if (gameState.exchangePhase?.active) {
          socket.emit("game:error", {
            message: "You must complete the exchange first",
            code: "EXCHANGE_PENDING",
          });
          return;
        }

        const currentIdx = gameState.currentTurnIndex;
        if (playerMap[currentIdx] !== userId) return;
        if (gameState.lastPlayedCombination === null) {
          socket.emit("game:error", { message: "You cannot pass", code: "CANNOT_PASS" });
          return;
        }

        const newState = processPass(gameState);
        appendReplayMove(game, currentIdx, null, newState);
        game.gameState = newState;

        broadcastGameState(io, game);
        persistGameState(roomId, game);
        armTurn(roomId);
      },
      { limit: 60, windowMs: 60_000 }
    );

    onEvent(
      socket,
      "game:rematch_intent",
      GameRematchIntentSchema,
      async ({ wants }) => {
        const roomId = socketRoomMap.get(socket.id);
        if (!roomId) return;
        const game = activeGames.get(roomId);
        if (!game) return;
        if (seatOfUser(game, userId) === null) return;

        game.rematchIntents.set(userId, wants);
        broadcastRematchIntents(io, game);
      },
      { limit: 20, windowMs: 60_000 }
    );

    onEvent(
      socket,
      "game:rematch_vote",
      NoPayloadSchema,
      async () => {
        const roomId = socketRoomMap.get(socket.id);
        if (!roomId) return;
        const game = activeGames.get(roomId);
        if (!game || !game.gameState.gameOver) return;
        if (seatOfUser(game, userId) === null) return;

        // `total` is the seated-seat count: bots and seats whose player left
        // hold no vote, exactly as countRematchAnswers counts them.
        const broadcastVoteState = () =>
          io.to(roomId).emit("game:vote_state", {
            votes: Array.from(game.rematchVotes),
            total: Object.keys(game.playerMap).length,
          });

        // The table was asked during the closing manche and said no. Nobody
        // gets to restart it from the results screen after that.
        if (game.matchOver && !tableWantsRematch(game)) {
          socket.emit("game:error", {
            message: "The table chose not to play again",
            code: "REMATCH_DECLINED",
          });
          return;
        }

        game.rematchVotes.add(userId);
        broadcastVoteState();
        if (game.rematchVotes.size < Object.keys(game.playerMap).length) return;

        // The database is read for the room's settings and nothing else: the
        // next manche's seats are copied from the running game. `room_players`
        // holds humans only, so a roster rebuilt from it drops every bot seat
        // and renumbers whatever is left.
        const room = await storage.getRoomById(roomId);
        if (!room) {
          socket.emit("game:error", { message: "Room not found", code: "ROOM_NOT_FOUND" });
          broadcastVoteState();
          return;
        }

        const seats = game.gameState.players;
        if (seats.length < 2) {
          socket.emit("game:error", {
            message: "At least 2 players are required",
            code: "MIN_PLAYERS_REQUIRED",
          });
          broadcastVoteState();
          return;
        }

        // Cleared only once the next manche is certain to be dealt. A vote
        // discarded on the way out of a bail-out can never be retried: the
        // overlay would sit below its own threshold with nothing left to press.
        game.rematchVotes.clear();

        const prevRankings = game.gameState.rankings;
        // Engine ids ride across the manche, so prevRankings resolves to the
        // same seats it named — initializeRematch never has to fall back to a
        // guessed winner, and the exchange runs between the right two players.
        const playerSetup = seats.map((p) => ({
          id: p.id,
          name: p.name,
          type: p.type,
          personality: p.personality,
          team: room.gameMode === "teams" ? p.team : undefined,
        }));

        const nextFirstSeat = nextDealFirstSeat(game.dealFirstSeat, playerSetup.length);
        const newGameState =
          prevRankings.length >= 2
            ? initializeRematch(playerSetup, room.gameMode, prevRankings, nextFirstSeat)
            : initializeGame(playerSetup, room.gameMode, nextFirstSeat);
        game.dealFirstSeat = nextFirstSeat;

        // `game.playerMap` is deliberately left alone: seat i of the new state
        // is seat i of the old one, because playerSetup was built from that
        // same array in order. playerMap is what sanitizeStateForPlayer reads
        // to decide whose hand each viewer is sent, so renumbering it here is
        // how a player ends up holding someone else's cards.
        game.gameState = newGameState;
        game.gameMode = room.gameMode;
        game.maxPlayers = room.maxPlayers;
        // A rematch deals a brand new hand — last hand's bomb/joker plays
        // must not leak into this one's achievement evaluation, its move log
        // has already been written to its own replay, and the seats walked out
        // on have already been recorded as the forfeit they were. Carrying
        // those forward would record the same departure again in every
        // remaining manche of the match.
        game.handFlags = {};
        game.moveLog = startReplayLog();
        game.abandonedSeats.clear();
        rollMatchForward(game);

        await storage.updateRoomStatus(roomId, "in_progress");

        broadcastGameState(io, game);
        io.to(roomId).emit("game:started");
        io.to(roomId).emit("game:match_state", {
          target: game.matchTarget,
          length: game.matchLength,
          scores: scoresByName(game),
        });

        persistGameState(roomId, game);
        armTurn(roomId);
      },
      { limit: 20, windowMs: 60_000 }
    );

    onEvent(
      socket,
      "game:rejoin",
      GameRejoinSchema,
      async ({ roomCode }) => {
        // onEvent's own catch turns a throw into a generic `game:error`,
        // which the client's rejoin-failed handling never listens for —
        // leaving the player stranded on a dead screen. A failure in here
        // must always resolve as game:rejoin_failed instead.
        //
        // Every one of those carries the wire's error contract — { code,
        // message } — so the client can render it in the player's language.
        // `roomCode` stays a top-level field alongside it: the client's
        // stale-reply guard matches on it, so it must not move into params.
        try {
          const existingGame = activeGames.get(roomCode);
          if (existingGame) {
            const seat = seatOfUser(existingGame, userId);
            if (seat === null) {
              socket.emit("game:rejoin_failed", { message: "Not authorized", code: "UNAUTHORIZED", roomCode });
              return;
            }

            // Idempotent — an INSERT on every reconnect would pile up
            // duplicate room_players rows and corrupt the next rematch.
            await storage
              .upsertRoomPlayer(roomCode, userId, seat)
              .catch((err: unknown) =>
                logger.warn({ err, roomCode, userId }, "upsertRoomPlayer failed")
              );

            await rejoinSocketToTable(
              io,
              socket,
              userId,
              username,
              roomCode,
              existingGame
            );
            logger.info({ userId, roomCode }, "Player rejoined game (from memory)");
            return;
          }

          const row = await db.query.activeGames.findFirst({
            where: eq(activeGamesTable.roomCode, roomCode),
          });
          if (!row) {
            socket.emit("game:rejoin_failed", { message: "Game not found", code: "GAME_NOT_FOUND", roomCode });
            return;
          }

          const persistedState = row.gameState as PersistedEnvelope<GameState> | null;
          if (isStaleSchema(persistedState)) {
            // Written under an older persisted shape. Restoring it deals a
            // silently corrupt hand rather than crashing, which is worse
            // than refusing outright.
            logger.warn(
              { roomCode, foundVersion: persistedState?.schemaVersion },
              "Discarding stale persisted game (schema mismatch)"
            );
            disposeGame(roomCode);
            socket.emit("game:rejoin_failed", { message: "Game no longer valid", code: "GAME_NO_LONGER_VALID", roomCode });
            return;
          }
          // isStaleSchema is a plain boolean helper (kept dependency-free for
          // unit testing), so TS can't narrow the null case through it —
          // the `return` above already ruled it out.
          const {
            gameState: restoredState,
            handFlags: restoredHandFlags,
            dealFirstSeat: restoredDealFirstSeat,
          } = unpackPersistedState(persistedState!);

          const playerMap = readPersistedPlayerMap(row.playerMap, row.playerIds);
          if (!Object.values(playerMap).includes(userId)) {
            socket.emit("game:rejoin_failed", { message: "Not authorized", code: "UNAUTHORIZED", roomCode });
            return;
          }

          const restoredScores = (row.scores as Record<string, number>) ?? {};
          const restoredPlayers = (restoredState as GameState).players;
          const restoredTarget = row.matchTarget ?? targetsFor(restoredPlayers.length)[0];
          const restoredMode = row.gameMode === "teams" ? "teams" : "free_for_all";
          const restoredLength = row.matchLength === "single" ? "single" : "match";
          const game: OnlineGameState = {
            roomId: roomCode,
            gameState: restoredState as GameState,
            playerMap,
            rematchVotes: new Set(),
            rematchIntents: new Map(),
            cumulativeScores: restoredScores,
            gameMode: restoredMode,
            maxPlayers: row.maxPlayers,
            matchTarget: restoredTarget,
            matchLength: restoredLength,
            matchOver: restoredMatchOver({
              matchLength: restoredLength,
              gameMode: restoredMode,
              handOver: (restoredState as GameState).gameOver,
              scores: restoredScores,
              target: restoredTarget,
              teamOfKey: teamKeyMap(playerMap, restoredPlayers),
              playerCount: restoredPlayers.length,
            }),
            handFlags: restoredHandFlags,
            // A hand restored after a restart has no record of who walked out
            // of it: the map is memory-only and the restart emptied it.
            abandonedSeats: new Map<number, string>(),
            spectators: new Set<string>(),
            // The log is memory-only, so a hand restored after a restart has
            // none and produces no replay. The next hand starts a fresh one.
            moveLog: null,
            dealFirstSeat: restoredDealFirstSeat,
          };
          activeGames.set(roomCode, game);
          if (row.isPublic) publicRoomIds.add(roomCode);
          logger.info({ roomCode }, "Rehydrated activeGames from DB after restart");

          const seat = seatOfUser(game, userId);
          if (seat !== null) {
            await storage
              .upsertRoomPlayer(roomCode, userId, seat)
              .catch((err: unknown) =>
                logger.warn({ err, roomCode, userId }, "upsertRoomPlayer failed")
              );
          }

          await rejoinSocketToTable(io, socket, userId, username, roomCode, game);
          logger.info({ userId, roomCode }, "Player rejoined game (from DB)");
        } catch (err) {
          logger.error({ err, roomCode, userId }, "game:rejoin failed");
          socket.emit("game:rejoin_failed", { message: "Errore del server", code: "SERVER_ERROR", roomCode });
        }
      },
      { limit: 20, windowMs: 60_000 }
    );

    onEvent(
      socket,
      "game:reaction",
      GameReactionSchema,
      ({ emoji }) => {
        const roomId = socketRoomMap.get(socket.id);
        if (!roomId) return;
        const game = activeGames.get(roomId);
        if (!game) return;

        const seat = seatOfUser(game, userId);
        if (seat === null) return;
        io.to(roomId).emit("game:reaction", {
          emoji,
          fromSeat: seat,
          username,
        });
      },
      { limit: 8, windowMs: 10_000 }
    );

    // ── Exchange card give ───────────────────────────────────────────────────

    onEvent(
      socket,
      "game:exchange_give_card",
      GameExchangeGiveCardSchema,
      ({ cardId }) => {
        const roomId = socketRoomMap.get(socket.id);
        if (!roomId) return;
        const game = activeGames.get(roomId);
        if (!game?.gameState.exchangePhase?.active) return;

        const seat = seatOfUser(game, userId);
        if (seat === null || seat !== game.gameState.exchangePhase.winnerIdx)
          return;

        const next = processExchangeChoice(game.gameState, cardId);
        if (next === game.gameState) {
          socket.emit("game:error", { message: "Invalid card", code: "INVALID_CARD" });
          return;
        }
        game.gameState = next;

        broadcastGameState(io, game);
        persistGameState(roomId, game);
        armTurn(roomId);
      },
      { limit: 30, windowMs: 60_000 }
    );

    // ── Friend invite ────────────────────────────────────────────────────────

    onEvent(
      socket,
      "friend:invite",
      FriendInviteSchema,
      async ({ friendUserId, roomCode }) => {
        // Only accepted friends may invite each other, and only a few per
        // minute — an invite is otherwise an unauthenticated broadcast
        // primitive that would let any user spam any userId.
        const areFriends = await storage.areFriends(userId, friendUserId);
        if (!areFriends) {
          socket.emit("friend:error", { message: "You are not friends", code: "NOT_FRIENDS" });
          return;
        }
        const friendSocket = userSocketMap.get(friendUserId);
        if (!friendSocket) {
          // Nothing about an invite expires while it waits — the room stays
          // `waiting` until the host starts it — so this is worth delivering
          // late. Not awaited: the invite must not be held up by a push.
          void notifyUser(friendUserId, {
            title: "Murlan",
            body: `${username} ti ha invitato a giocare.`,
            data: { roomCode },
          });
          return;
        }
        io.to(friendSocket).emit("friend:invite", {
          from: username,
          roomCode,
        });
      },
      { limit: 5, windowMs: 60_000 }
    );

    onEvent(
      socket,
      "friend:get_online_list",
      NoPayloadSchema,
      async () => {
        const userFriends = await storage.getFriends(userId);
        const onlineIds = userFriends
          .map((f) => f.friend.id)
          .filter((id) => userSocketMap.has(id));
        socket.emit("friend:online_list", { onlineIds });
      },
      { limit: 20, windowMs: 60_000 }
    );

    // ── Reconnect notice + friends list (async — every listener above is
    // already registered, so nothing emitted while these awaits are in
    // flight can be dropped) ──────────────────────────────────────────────

    const pendingDcTimer = disconnectTimers.get(userId);
    if (pendingDcTimer) {
      clearTimeout(pendingDcTimer);
      disconnectTimers.delete(userId);

      for (const [roomId, game] of activeGames.entries()) {
        if (seatOfUser(game, userId) === null || game.gameState.gameOver) continue;
        await rejoinSocketToTable(io, socket, userId, username, roomId, game);
        logger.info(
          { userId, username, roomId },
          "Player reconnected within grace period"
        );
        break;
      }
    }

    try {
      // One read for both halves of the connect notice: the friends who must
      // be told this account came online, and the online list this socket is
      // sent, are the same rows.
      const friends = await storage.getFriends(userId);
      announceOnlineToFriends(io, userId, friends);
      const onlineIds = friends
        .map((f) => f.friend.id)
        .filter((id) => userSocketMap.has(id));
      socket.emit("friend:online_list", { onlineIds });
    } catch {
      // non-critical
    }

    // ── Disconnect ───────────────────────────────────────────────────────────

    socket.on("disconnect", () => {
      void (async () => {
        try {
          // A spectator holds no seat, so none of the grace/AFK machinery below
          // applies to them; they are simply dropped.
          const spectatingRoom = spectatorRoomMap.get(socket.id);
          if (spectatingRoom) {
            activeGames.get(spectatingRoom)?.spectators.delete(userId);
            spectatorRoomMap.delete(socket.id);
          }
          // Only blank the mapping if it still points at THIS socket: a second
          // tab or a fast reconnect would otherwise black out the live one.
          if (userSocketMap.get(userId) === socket.id) {
            userSocketMap.delete(userId);
          }
          logger.debug({ userId, socketId: socket.id }, "Socket disconnected");

          await storage
            .updateLastSeen(userId)
            .catch((err) =>
              logger.debug({ err, userId }, "Failed to update users.last_seen on disconnect")
            );

          const lastSeen = new Date().toISOString();
          void emitFriendStatusOffline(io, userId, lastSeen);

          const currentRoomId = socketRoomMap.get(socket.id);
          socketRoomMap.delete(socket.id);
          if (!currentRoomId) return;

          // Still connected elsewhere — nothing to tear down.
          if (userSocketMap.has(userId)) return;

          const game = activeGames.get(currentRoomId);

          if (!game || game.gameState.gameOver) {
            // In the lobby, or at the results screen: nobody is mid-turn, so
            // there is nothing for a grace period to protect. The seat is
            // freed straight away or it keeps counting towards the rematch
            // gate and the remaining players can never start the next manche.
            await handleSeatRelease(io, currentRoomId, userId, username, {
              source: "disconnect",
            });
            return;
          }

          const graceSeconds = Math.round(DISCONNECT_GRACE_MS / 1000);
          io.to(currentRoomId).emit("game:player_disconnected", {
            userId,
            username,
            code: "PLAYER_DISCONNECTED_GRACE",
            // The grace period is configurable, so the number has to come from
            // the same constant the timer below is armed with — a hardcoded
            // "60 seconds" in the text is a promise the server may not keep.
            message: `${username} si è disconnesso. Ha ${graceSeconds} secondi per rientrare.`,
            params: { username, seconds: graceSeconds },
          });

          // A vacant seat must keep playing while we wait, or the table stalls
          // for a full minute on this player's turn.
          armTurn(currentRoomId);

          const prevTimer = disconnectTimers.get(userId);
          if (prevTimer) clearTimeout(prevTimer);

          const dcTimer = setTimeout(() => {
            void (async () => {
              try {
                disconnectTimers.delete(userId);
                if (userSocketMap.has(userId)) return;

                await storage
                  .removeRoomPlayer(currentRoomId, userId)
                  .catch((err) =>
                    logger.warn(
                      { err, roomId: currentRoomId, userId },
                      "Failed to delete the room_players row after the disconnect grace expired — the seat stays counted as taken"
                    )
                  );
                await vacateSeat(io, currentRoomId, userId, username);
                logger.info(
                  { userId, username, roomId: currentRoomId },
                  "Disconnect grace expired — seat handed to a bot"
                );
              } catch (err) {
                logger.error(
                  { err, userId, roomId: currentRoomId },
                  "Disconnect timeout handler failed"
                );
              }
            })();
          }, DISCONNECT_GRACE_MS);
          disconnectTimers.set(userId, dcTimer);
        } catch (err) {
          logger.error({ err, userId }, "disconnect handler failed");
        }
      })();
    });
  });

  startSweeper();

  return io;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function roomStatePayload(
  room: {
    id: string;
    code: string;
    hostUserId: string | null;
    status: string;
    gameMode: string;
    maxPlayers: number;
  },
  players: { seatIndex: number; userId: string; user: { username: string } }[]
) {
  return {
    roomId: room.id,
    code: room.code,
    hostUserId: room.hostUserId,
    status: room.status,
    gameMode: room.gameMode,
    maxPlayers: room.maxPlayers,
    players: players.map((p) => ({
      seatIndex: p.seatIndex,
      userId: p.userId,
      username: p.user.username,
    })),
  };
}

/**
 * Re-sends `room:state` to a single reconnecting/rejoining socket. The
 * client's only route back into the game screen is `room` (non-null) ->
 * `/(online)/room` -> `gameState` (non-null) -> `/(online)/game`; replying to
 * a rejoin with `game:state` alone leaves `room` null and strands the player
 * on the lobby holding a live hand with no way back in.
 */
async function emitRoomStateTo(socket: Socket, roomCode: string) {
  const room = await storage.getRoomById(roomCode);
  if (!room) return;
  const players = await storage.getRoomPlayers(roomCode);
  socket.emit("room:state", roomStatePayload(room, players));
}

/**
 * Puts a socket back at a table it holds a seat at: room membership, the two
 * snapshots the client's navigation chain needs to render the game, the notice
 * the rest of the table sees, and the turn scheduler.
 *
 * The one emitter of `game:player_reconnected`, so its payload cannot differ
 * between the `game:rejoin` handler and the connection handler's grace-timer
 * block. The caller owns the seat check and the `room_players` row: the
 * grace-timer path still holds a row, the rejoin path may not.
 */
async function rejoinSocketToTable(
  io: SocketServer,
  socket: Socket,
  userId: string,
  username: string,
  roomId: string,
  game: OnlineGameState
) {
  socket.join(roomId);
  socketRoomMap.set(socket.id, roomId);

  // Two DB reads, and the rejoin does not depend on either: the seat is
  // already valid and `game:state` below is what the table is drawn from. The
  // handler's blanket catch turns any throw into a SERVER_ERROR rejoin
  // failure, so letting this one propagate would forfeit a live game over a
  // roster refresh.
  await emitRoomStateTo(socket, roomId).catch((err: unknown) =>
    logger.warn({ err, roomId, userId }, "emitRoomStateTo failed")
  );
  socket.emit(
    "game:state",
    sanitizeStateForPlayer(game.gameState, userId, game.playerMap, game.turnDeadlineMs)
  );
  io.to(roomId).emit("game:player_reconnected", {
    userId,
    username,
    code: "PLAYER_RECONNECTED",
    message: `${username} è rientrato.`,
    params: { username },
  });
  armTurnIfIdle(roomId);
}

function seatClaimMessage(
  reason: "no_room" | "not_waiting" | "full" | "already_joined"
): string {
  switch (reason) {
    case "no_room":
      return "Room not found";
    case "not_waiting":
      return "Game already started";
    case "full":
      return "Room full";
    case "already_joined":
      return "You are already in the room";
  }
}

// Stable code counterpart to seatClaimMessage's English fallback text, so the
// client can localise the same rejection reason (see the `code` field above).
function seatClaimCode(
  reason: "no_room" | "not_waiting" | "full" | "already_joined"
): string {
  switch (reason) {
    case "no_room":
      return "ROOM_NOT_FOUND";
    case "not_waiting":
      return "GAME_ALREADY_STARTED";
    case "full":
      return "ROOM_FULL";
    case "already_joined":
      return "ALREADY_IN_ROOM";
  }
}

/**
 * Deletes `active_games` rows untouched for longer than
 * `ABANDONED_GAME_MAX_AGE_MS`. Returns how many went, so a caller can tell
 * "nothing to do" from "did not run".
 */
async function pruneAbandonedGames(): Promise<number> {
  const cutoff = new Date(Date.now() - ABANDONED_GAME_MAX_AGE_MS);
  const gone = await db
    .delete(activeGamesTable)
    .where(lt(activeGamesTable.updatedAt, cutoff))
    .returning({ roomCode: activeGamesTable.roomCode });
  if (gone.length > 0) {
    logger.info({ count: gone.length }, "Pruned abandoned games orphaned by a restart");
  }
  return gone.length;
}

/**
 * Deletes rooms nobody can still be playing in, and the seats that name them.
 *
 * `disposeGame` clears the `active_games` row when a table ends;
 * `updateRoomStatus(…, "finished")` is all that ever happened to the `rooms`
 * row, so every online game ever played left one behind, plus a
 * `room_players` row per seat. `room_players` has no cascade, so its rows go
 * first — the same order `storage.deleteUser` uses.
 *
 * A room still in the in-memory map is never a candidate, whatever its age.
 */
async function pruneStaleRooms(): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_ROOM_MAX_AGE_MS);
  const candidates = await db
    .select({ id: roomsTable.id })
    .from(roomsTable)
    .where(lt(roomsTable.createdAt, cutoff))
    .limit(STALE_ROOM_BATCH);

  const ids = candidates.map((r) => r.id).filter((id) => !activeGames.has(id));
  if (ids.length === 0) return 0;
  // A lobby nobody ever came back to keeps its dropout records until here.
  ids.forEach((id) => lobbyDropouts.delete(id));

  await db.delete(roomPlayersTable).where(inArray(roomPlayersTable.roomId, ids));
  await db.delete(activeGamesTable).where(inArray(activeGamesTable.roomCode, ids));
  const gone = await db
    .delete(roomsTable)
    .where(inArray(roomsTable.id, ids))
    .returning({ id: roomsTable.id });

  if (gone.length > 0) {
    logger.info({ count: gone.length }, "Pruned rooms nobody can still be playing in");
  }
  return gone.length;
}

let sweeper: ReturnType<typeof setInterval> | null = null;

/**
 * Long-running server hygiene: drop finished tables nobody is connected to and
 * forget public rooms that are no longer joinable.
 */
function startSweeper() {
  if (sweeper) return;
  sweeper = setInterval(() => {
    try {
      for (const [roomId, game] of activeGames.entries()) {
        safeTimer("sweepFinishedTable", roomId, () => {
          const anyoneConnected = Object.values(game.playerMap).some((uid) =>
            userSocketMap.has(uid)
          );
          if (!anyoneConnected && game.gameState.gameOver) {
            disposeGame(roomId);
          }
        });
      }

      // Rows orphaned by a restart, which the loop above structurally cannot
      // reach: it walks memory, and a restart is what emptied memory.
      void pruneAbandonedGames().catch((err: unknown) =>
        logger.error({ err }, "Pruning abandoned games failed")
      );

      void pruneStaleRooms().catch((err: unknown) =>
        logger.error({ err }, "Pruning stale rooms failed")
      );

      for (const roomId of Array.from(publicRoomIds)) {
        void storage
          .getRoomById(roomId)
          .then((room) => {
            if (!room || room.status !== "waiting") publicRoomIds.delete(roomId);
          })
          .catch((err) =>
            logger.warn(
              { err, roomId },
              "Failed to read the rooms row while sweeping — the public room list keeps a possibly unjoinable entry"
            )
          );
      }
    } catch (err) {
      logger.error({ err }, "Sweeper failed");
    }
  }, SWEEP_INTERVAL_MS);
  (sweeper as unknown as { unref?: () => void }).unref?.();
}

/**
 * Releases a seat: the room_players row, the user's timers, and — when the
 * room still holds a live game — the seat in it.
 *
 * The two ways a seat is released are a `room:leave` and a lost connection,
 * and they differ only in what the caller can hand over: a socket to take out
 * of the socket.io room, and whether the lobby is told a player left. The
 * seat-side work is identical, which is why it lives in one place.
 *
 * Runs on the disconnect path inside a `void (async () => …)`, so every
 * storage call is `.catch`-guarded: an unguarded throw there is a logged
 * failure that silently strands the room.
 */
async function handleSeatRelease(
  io: SocketServer,
  roomId: string,
  userId: string,
  username: string,
  opts: {
    socket?: { id: string; leave: (r: string) => void };
    source: "leave" | "disconnect";
  }
) {
  clearAllTimersForUser(userId, roomId);

  await storage
    .removeRoomPlayer(roomId, userId)
    .catch((err) =>
      logger.warn(
        { err, roomId, userId, source: opts.source },
        "Failed to delete the room_players row after a seat was released — the seat stays counted as taken"
      )
    );
  opts.socket?.leave(roomId);

  const room = await storage.getRoomById(roomId).catch((err) => {
    logger.warn({ err, roomId, userId }, "Failed to read the rooms row while releasing a seat");
    return null;
  });
  if (!room) return;

  if (room.status === "waiting") {
    const remaining = await storage.getRoomPlayers(roomId).catch((err) => {
      logger.warn({ err, roomId }, "Failed to read the remaining lobby players");
      return [];
    });
    if (remaining.length === 0) {
      await storage
        .updateRoomStatus(roomId, "finished")
        .catch((err) =>
          logger.warn(
            { err, roomId },
            "Failed to set rooms.status = finished after the last player left the lobby"
          )
        );
      publicRoomIds.delete(roomId);
      lobbyDropouts.delete(roomId);
      return;
    }
    // A lost connection is the only release room:rejoin may answer: a
    // `room:leave` is the player choosing to go, and room:join is how they come
    // back from that. Recorded before the migration below, so it holds who was
    // host at the moment of the drop.
    if (opts.source === "disconnect") {
      rememberLobbyDropout(roomId, userId, room.hostUserId === userId);
    }
    let newHostId = room.hostUserId;
    if (room.hostUserId === userId) {
      const nextHost = remaining.sort((a, b) => a.seatIndex - b.seatIndex)[0];
      newHostId = nextHost.userId;
      await storage
        .updateRoomHost(roomId, newHostId)
        .catch((err) =>
          logger.warn(
            { err, roomId, userId, newHostId },
            "Failed to update rooms.host_user_id after the host left the lobby"
          )
        );
    }
    io.to(roomId).emit(
      "room:state",
      roomStatePayload({ ...room, hostUserId: newHostId }, remaining)
    );
    // Only a lost connection announces this; a `room:leave` never has.
    if (opts.source === "disconnect") {
      io.to(roomId).emit("room:player_left", { userId, username });
    }
  } else if (activeGames.has(roomId)) {
    // A live game in memory is the only authority on whether the seat is still
    // held: `rooms.status` reads "finished" between manches too, so it cannot
    // tell an ended match from a table waiting to deal again. Removing the DB
    // row alone leaves the seat live in the in-memory game — auto-playing the
    // leaver's hand mid-manche, or blocking the rematch gate between them.
    await vacateSeat(io, roomId, userId, username);
  }
}

/**
 * Enforces one live socket per account: the newest connection keeps the
 * account and the socket it replaced is told why before it is closed.
 *
 * `userSocketMap` must already name the new socket when this is called. The
 * replaced socket's own disconnect handler reads it, and both of its guards
 * then decline to act — the mapping no longer matches that socket id, so it is
 * left alone, and the account still has a socket, so no
 * `game:player_disconnected` is announced and no grace timer is armed. The
 * player keeps their seat; only the connection changes.
 *
 * Which is why the room association has to move with the account. Those same
 * guards mean nothing else will release the seat, and the replacement only
 * acquires a `socketRoomMap` entry of its own if the client happens to rejoin —
 * a device that never held the room code never does. Handing the entry over
 * keeps the seat reachable by the room's broadcasts and leaves the ordinary
 * disconnect path owning its release, so closing the replacement announces the
 * drop, arms the grace and hands the seat to a bot exactly as one connection
 * always did.
 *
 * The client stops reconnecting when it sees this code
 * (`context/SocketContext.tsx`). It has to: socket.io retries a closed
 * transport forever, so two tabs would otherwise evict each other for as long
 * as both are open.
 */
function evictReplacedSession(
  io: SocketServer,
  userId: string,
  replacedSocketId: string,
  replacement: Socket
) {
  const replaced = io.sockets.sockets.get(replacedSocketId);
  if (!replaced) return;

  const roomId = socketRoomMap.get(replacedSocketId);
  if (roomId) {
    socketRoomMap.delete(replacedSocketId);
    socketRoomMap.set(replacement.id, roomId);
    void replacement.join(roomId);
  }

  replaced.emit("socket:error", {
    code: "SESSION_REPLACED",
    message: "Il tuo account è stato aperto altrove. Questa sessione è stata chiusa.",
  });
  logger.info(
    { userId, replacedSocketId },
    "Session replaced by a newer connection for the same account"
  );
  replaced.disconnect(true);
}

/**
 * Tells every friend who is online that `userId` just came online. Takes the
 * friend rows rather than reading them, so the connection handler pays for one
 * `getFriends` and not two.
 */
function announceOnlineToFriends(
  io: SocketServer,
  userId: string,
  friends: Awaited<ReturnType<typeof storage.getFriends>>
) {
  // The read the caller did is awaited, so the socket may already be gone.
  if (!userSocketMap.has(userId)) return;
  friends.forEach((f) => {
    const friendSocket = userSocketMap.get(f.friend.id);
    if (friendSocket) {
      io.to(friendSocket).emit("friend:status", { userId, online: true });
    }
  });
}

async function emitFriendStatusOffline(
  io: SocketServer,
  userId: string,
  lastSeen: string
) {
  // Short debounce: if the user reconnects within 400ms, skip the offline emit
  await new Promise((resolve) => setTimeout(resolve, 400));
  // Abort if user already reconnected before the delay elapsed
  if (userSocketMap.has(userId)) return;
  const friends = await storage.getFriends(userId).catch(() => []);
  // Double-check after the DB query: reconnect might have happened during getFriends
  if (userSocketMap.has(userId)) return;
  friends.forEach((f) => {
    const friendSocket = userSocketMap.get(f.friend.id);
    if (friendSocket) {
      io.to(friendSocket).emit("friend:status", {
        userId,
        online: false,
        lastSeen,
      });
    }
  });
}
