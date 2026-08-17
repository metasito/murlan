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
import { onEvent } from "./socketSafety.ts";
import {
  readPersistedPlayerMap,
  seatOfUser as seatOfUserInMap,
  scoreKeyForSeat as scoreKeyForMapSeat,
  findViewerSeat,
  visibleExchangePhase,
  excludeBotSeats,
  isContestedTable,
  buildSeatRoster,
  isStaleSchema,
  packPersistedState,
  unpackPersistedState,
  type PersistedEnvelope,
} from "./onlineGameLogic.ts";
import {
  NoPayloadSchema,
  RoomCreateSchema,
  RoomJoinSchema,
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
  scoreHand,
  addHandScores,
  isMajority,
  resolveMatch,
  resolveTeamMatch,
  MATCH_TARGETS,
} from "../lib/gameEngine.ts";
import type { GameState, Card, GameMode, Combination, MatchLength } from "../lib/gameEngine.ts";
import { recordGameResult } from "./stats.ts";
import { saveReplay } from "./replays.ts";
import { recordRatedResult } from "./ratings.ts";
import { appendReplayMove, replaySeatsOf, startReplayLog } from "./replayShape.ts";
import type { GameResult } from "../lib/achievements.ts";
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
  /** The restart-orphan prune, which only a real database can exercise. */
  pruneAbandonedGames: () => pruneAbandonedGames(),
  ABANDONED_GAME_MAX_AGE_MS,
  pruneStaleRooms,
  STALE_ROOM_MAX_AGE_MS,
};

function sanitizeStateForPlayer(
  state: GameState,
  viewerUserId: string,
  playerMap: Record<number, string>
) {
  // The server knows which seat the viewer occupies authoritatively; ship it
  // with every state so the client never has to derive it (e.g. from a lobby
  // `room` object that is null across a cold-start rejoin).
  const viewerSeatIndex = findViewerSeat(playerMap, viewerUserId);
  return {
    ...state,
    viewerSeatIndex,
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

function persistGameState(roomId: string, game: OnlineGameState) {
  const playerIds = Object.values(game.playerMap);
  const playerMap = game.playerMap as Record<string, string>;
  // Stamped so a restart can tell a current-shape row from a stale one (see
  // GAME_SCHEMA_VERSION) rather than restoring a corrupt hand silently.
  const persistedState = packPersistedState(game.gameState, game.handFlags);
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
  db.insert(activeGamesTable)
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
    io.to(target).emit("game:state", sanitizeStateForPlayer(gameState, uid, playerMap));
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
    const valid = getValidGivebackCards(player.hand);
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
  if (game.gameState.gameOver) return;

  const seat = actingSeat(game.gameState);
  const userId = game.playerMap[seat];

  if (userId === undefined) {
    botTimers.set(
      roomId,
      setTimeout(() => {
        botTimers.delete(roomId);
        runBotTurn(roomId);
      }, BOT_MOVE_DELAY_MS)
    );
    return;
  }

  const username = game.gameState.players[seat]?.name ?? "";
  startAfkTimer(roomId, userId, username);
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

/** Returns true when a move was actually made. */
function handleAutoPass(roomId: string, userId: string): boolean {
  const io = _io;
  const game = activeGames.get(roomId);
  if (!io || !game || game.gameState.gameOver) return false;

  const seat = actingSeat(game.gameState);
  if (game.playerMap[seat] !== userId) return false;

  const next = autoMoveForSeat(game, seat, false);
  if (!next) return false;

  game.gameState = next;
  broadcastGameState(io, game);
  persistGameState(roomId, game);

  if (next.gameOver) {
    void handleGameOver(io, roomId, game);
  } else {
    armTurn(roomId);
  }
  return true;
}

function startAfkTimer(roomId: string, userId: string, username: string) {
  clearAfkTimer(roomId, userId);
  const key = `${roomId}:${userId}`;
  afkTimers.set(
    key,
    setTimeout(() => {
      afkTimers.delete(key);
      const acted = handleAutoPass(roomId, userId);
      // Only announce when something actually happened, not on an early
      // return that did nothing.
      if (acted && _io) {
        _io.to(roomId).emit("game:notification", {
          type: "afk",
          code: "PLAYER_AFK_AUTO_PASS",
          message: `${username} è inattivo — passato automaticamente`,
          params: { username },
        });
      }
    }, AFK_TIMEOUT_MS)
  );
}

// ─── Seat vacancy ─────────────────────────────────────────────────────────────

/**
 * Frees a seat whose player is gone for good (grace period expired, or an
 * explicit leave mid-game) and hands it to a bot. The hand stays in play, so
 * the table can always continue: the seat must be removed from `playerMap`
 * *and* marked AI-controlled together, or the table deadlocks as soon as the
 * turn comes round to it.
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

  const remaining = Object.keys(game.playerMap).length;

  if (game.gameState.gameOver) {
    // Between hands: the leaver simply stops counting towards the rematch
    // vote. The table isn't "interrupted" here — it's still the lobby.
    io.to(roomId).emit("game:player_left", { userId, username, seatIndex: seat });
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
    await storage
      .updateRoomStatus(roomId, "finished")
      .catch((err) =>
        logger.warn(
          { err, roomId, userId, seat },
          "Failed to set rooms.status = finished after the table was abandoned mid-hand"
        )
      );
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

/**
 * Scoring key -> team id, for the seated humans only. Vacated (`bot:<seat>`)
 * seats are left out on purpose: they are already excluded from
 * `cumulativeScores` (see `excludeBotSeats`), so including them here would add
 * a zero-scoring member that can never win but could be named as one.
 */
function teamKeyMap(
  game: OnlineGameState,
  state: GameState
): Record<string, string> {
  const map: Record<string, string> = {};
  state.players.forEach((p, seat) => {
    const userId = game.playerMap[seat];
    if (userId === undefined || !p.team) return;
    map[userId] = p.team;
  });
  return map;
}

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

  // rankings hold engine player ids ("player_0"); score by seat -> user so the
  // scoreboard is keyed by a real identity instead of an engine id wearing a
  // username label.
  const seatOfEngineId = new Map<string, number>();
  state.players.forEach((p, idx) => seatOfEngineId.set(p.id, idx));

  const handByEngineId = scoreHand(state.rankings, state.players.length);
  const handByKey: Record<string, number> = {};
  for (const [engineId, points] of Object.entries(handByEngineId)) {
    const seat = seatOfEngineId.get(engineId);
    if (seat === undefined) continue;
    handByKey[scoreKeyForSeat(game, seat)] = points;
  }

  // A vacated seat is scored under `bot:<seat>` (see scoreKeyForSeat) purely
  // so the per-hand breakdown below has something to key off of. It must
  // never accumulate towards the match, or a bot can cross the match target
  // and be announced as the winner under the departed human's username.
  const scorableHandByKey = excludeBotSeats(handByKey);

  game.cumulativeScores = addHandScores(game.cumulativeScores, scorableHandByKey);

  let matchWinners: string[] = [];
  let isDraw = false;

  if (game.matchLength === "single") {
    // A quick game is one manche: whoever took it has won the match.
    game.matchOver = true;
    const topSeat = seatOfEngineId.get(state.rankings[0] ?? "");
    matchWinners = topSeat === undefined ? [] : [scoreKeyForSeat(game, topSeat)];
  } else {
    // Teams mode races to the target as a *pair* (docs/RULES.md §11: the two
    // partners' placement points are summed), so the match must be resolved on
    // the team total and both partners reported as winners. Free-for-all is
    // unchanged.
    const teamOfKey = teamKeyMap(game, state);
    const resolution =
      game.gameMode === "teams" && Object.keys(teamOfKey).length > 0
        ? resolveTeamMatch(game.cumulativeScores, teamOfKey, game.matchTarget)
        : resolveMatch(game.cumulativeScores, game.matchTarget);
    if (resolution) {
      if (resolution.newTarget !== null) {
        game.matchTarget = resolution.newTarget;
      } else {
        game.matchOver = true;
        isDraw = resolution.isDraw;
        matchWinners = resolution.winners;
      }
    }
  }

  const matchContinues = game.matchOver ? tableWantsRematch(game) : false;

  // Wire format: the clients index the scoreboard by display name.
  const byName: Record<string, number> = {};
  const detailed = state.players.map((p, seat) => {
    const key = scoreKeyForSeat(game, seat);
    const total = game.cumulativeScores[key] ?? 0;
    byName[p.name] = total;
    return {
      seatIndex: seat,
      userId: game.playerMap[seat] ?? null,
      username: p.name,
      points: handByKey[key] ?? 0,
      total,
    };
  });

  game.rematchVotes = new Set();

  const winnerNames = matchWinners
    .map(
      (key) =>
        detailed.find((d) => scoreKeyForSeat(game, d.seatIndex) === key)?.username
    )
    .filter((n): n is string => !!n);

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
  // running match instead of silently resetting the scoreboard.
  persistGameState(roomId, game);

  // ── Stats / history / achievements ────────────────────────────────────────
  //
  // Deliberately placed after every broadcast/persist above, not before: the
  // game-over guarantee is "a stats write must never block or fail the
  // game", and handleGameOver is itself async with two call sites that
  // invoke it as bare `void` (see runBotTurn / the game:play handler) — a
  // throw anywhere above this point would reject its promise and surface as
  // an unhandled rejection *before* game:over ever reached the room. Putting
  // the whole block, including the synchronous result-shaping below, after
  // the broadcast makes that ordering obvious rather than relying on a
  // try/catch staying in place.
  try {
    // Every seat carries a placement by the time a hand ends — the engine
    // fills the remaining positions for anyone still holding cards, in both
    // modes (see assignRemainingPlacements) — so every seated player is
    // represented in `gameResults` and counted toward `gamesPlayed`, not just
    // the ones who actually emptied their hand.
    const playerCount = state.players.length;
    // How many seats actually emptied their hand this hand, read straight off
    // the final state rather than inferred from the mode: a seat that was
    // auto-assigned its position while still holding cards never "finished",
    // and must not be counted as one of anyone's finished opponents.
    const realFinisherCount = state.players.filter(
      (p) => p.hand.length === 0
    ).length;

    const gameResults: GameResult[] = state.rankings
      .map((engineId, idx) => {
        const seat = seatOfEngineId.get(engineId);
        if (seat === undefined) return null;
        const placement = idx + 1;
        const key = scoreKeyForSeat(game, seat);
        const flags = game.handFlags[seat] ?? { bomb: false, joker: false };
        const emptiedOwnHand = state.players[seat].hand.length === 0;
        const result: GameResult = {
          userId: key,
          placement,
          playerCount,
          playedBomb: flags.bomb,
          playedJoker: flags.joker,
          matchWon: matchWinners.includes(key),
          opponentsFinished: Math.max(
            realFinisherCount - (emptiedOwnHand ? 1 : 0),
            0
          ),
        };
        return result;
      })
      .filter((r): r is GameResult => r !== null);

    // Bot-filled tables stay fully playable, but nothing about them is
    // recorded: a private room of one human plus bots would otherwise be
    // guaranteed points and free achievements. See isContestedTable for
    // where the line sits.
    const humanSeats = Object.keys(game.playerMap).length;
    const botSeats = Math.max(playerCount - humanSeats, 0);
    if (!isContestedTable(humanSeats, botSeats)) {
      logger.info(
        { roomId, humanSeats, botSeats },
        "Bot-majority table — stats, history and achievements not recorded"
      );
    } else {
      // Deliberately not awaited: a stats write must never be able to block
      // or delay whatever runs after handleGameOver at any of its call sites.
      recordGameResult(gameResults, game.gameMode).catch((err) =>
        logger.error({ err, roomId }, "Failed to record game results")
      );
    }

    // The ladder moves on the same gate as stats: a bot-majority table awards
    // nothing, or a private room of bots would be free rating. Human seats only,
    // and free-for-all only — recordRatedResult declines a teams result, whose
    // placement belongs to the pair rather than to either partner.
    if (isContestedTable(humanSeats, botSeats)) {
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
    // Belt-and-braces: even the synchronous shaping above must not be able
    // to throw back into handleGameOver's own promise (see the comment
    // above this block).
    logger.error({ err, roomId }, "Failed to shape game results for stats");
  }
}

/** Between hands: a finished match starts over, an unfinished one carries on. */
function rollMatchForward(game: OnlineGameState) {
  if (game.matchOver) {
    game.cumulativeScores = {};
    game.matchTarget = MATCH_TARGETS[0];
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

      const user = await storage.getUser(claimedUserId).catch(() => null);
      if (!user) return next(new Error("Not authenticated"));

      socket.data.userId = user.id;
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
    userSocketMap.set(userId, socket.id);
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
          sanitizeStateForPlayer(game.gameState, userId, game.playerMap)
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

    onEvent(
      socket,
      "room:leave",
      NoPayloadSchema,
      async () => {
        const leavingRoomId = socketRoomMap.get(socket.id);
        await handleLeaveRoom(io, socket, userId, username);
        if (leavingRoomId && publicRoomIds.has(leavingRoomId)) {
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
        if (
          !room ||
          room.hostUserId !== userId ||
          (room.status !== "waiting" && room.status !== "finished")
        )
          return;

        const players = await storage.getRoomPlayers(room.id);
        // With bots filling every empty seat, one seated human is enough —
        // the min-2 guard only matters for an all-human table.
        if (!fillWithBots && players.length < 2) {
          socket.emit("room:error", { message: "At least 2 players are required", code: "MIN_PLAYERS_REQUIRED" });
          return;
        }
        if (players.length < 1) return;

        const previous = activeGames.get(roomId);
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

        const playerSetup = roster.map((r, idx) => ({
          name: r.username,
          type: (r.isBot ? "ai" : "human") as "human" | "ai",
          personality: r.isBot ? r.personality : undefined,
          team:
            room.gameMode === "teams"
              ? ((idx % 2 === 0 ? "A" : "B") as "A" | "B")
              : undefined,
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
          matchTarget: previous?.matchTarget ?? MATCH_TARGETS[0],
          matchLength: matchLength ?? previous?.matchLength ?? "match",
          matchOver: previous?.matchOver ?? false,
          handFlags: {},
          spectators: new Set<string>(),
          moveLog: startReplayLog(),
        };
        rollMatchForward(newGame);
        activeGames.set(roomId, newGame);

        publicRoomIds.delete(roomId);
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
        // The table was asked during the closing manche and said no. Nobody
        // gets to restart it from the results screen after that.
        if (game.matchOver && !tableWantsRematch(game)) return;

        game.rematchVotes.add(userId);

        const totalPlayers = Object.keys(game.playerMap).length;
        io.to(roomId).emit("game:vote_state", {
          votes: Array.from(game.rematchVotes),
          total: totalPlayers,
        });

        if (game.rematchVotes.size < totalPlayers) return;
        game.rematchVotes.clear();

        const room = await storage.getRoomById(roomId);
        if (!room) return;
        const players = await storage.getRoomPlayers(roomId);
        if (players.length < 2) return;

        const prevRankings = game.gameState.rankings;
        const playerSetup = players.map((p, idx) => ({
          id: `player_${idx}`,
          name: p.user.username,
          type: "human" as const,
          team:
            room.gameMode === "teams"
              ? ((idx % 2 === 0 ? "A" : "B") as "A" | "B")
              : undefined,
        }));

        const newGameState =
          prevRankings.length >= 2
            ? initializeRematch(playerSetup, room.gameMode, prevRankings)
            : initializeGame(playerSetup, room.gameMode);

        const playerMap: Record<number, string> = {};
        players.forEach((p, idx) => {
          playerMap[idx] = p.userId;
        });

        game.gameState = newGameState;
        game.playerMap = playerMap;
        game.gameMode = room.gameMode;
        game.maxPlayers = room.maxPlayers;
        // A rematch deals a brand new hand — last hand's bomb/joker plays
        // must not leak into this one's achievement evaluation, and its move
        // log has already been written to its own replay.
        game.handFlags = {};
        game.moveLog = startReplayLog();
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
        try {
          const existingGame = activeGames.get(roomCode);
          if (existingGame) {
            const seat = seatOfUser(existingGame, userId);
            if (seat === null) {
              socket.emit("game:rejoin_failed", { reason: "Not authorized", code: "UNAUTHORIZED", roomCode });
              return;
            }

            socket.join(roomCode);
            socketRoomMap.set(socket.id, roomCode);
            // Idempotent — an INSERT on every reconnect would pile up
            // duplicate room_players rows and corrupt the next rematch.
            await storage
              .upsertRoomPlayer(roomCode, userId, seat)
              .catch((err: unknown) =>
                logger.warn({ err, roomCode, userId }, "upsertRoomPlayer failed")
              );

            // room:state is what the client's navigation chain
            // (index -> room -> game) actually gates on; replying with
            // game:state alone leaves `room` null forever.
            await emitRoomStateTo(socket, roomCode);

            socket.emit(
              "game:state",
              sanitizeStateForPlayer(
                existingGame.gameState,
                userId,
                existingGame.playerMap
              )
            );
            io.to(roomCode).emit("game:player_reconnected", {
              userId,
              username,
              code: "PLAYER_RECONNECTED",
              message: `${username} è rientrato.`,
              params: { username },
            });
            armTurn(roomCode);
            logger.info({ userId, roomCode }, "Player rejoined game (from memory)");
            return;
          }

          const row = await db.query.activeGames.findFirst({
            where: eq(activeGamesTable.roomCode, roomCode),
          });
          if (!row) {
            socket.emit("game:rejoin_failed", { reason: "Game not found", code: "GAME_NOT_FOUND", roomCode });
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
            socket.emit("game:rejoin_failed", { reason: "Game no longer valid", code: "GAME_NO_LONGER_VALID", roomCode });
            return;
          }
          // isStaleSchema is a plain boolean helper (kept dependency-free for
          // unit testing), so TS can't narrow the null case through it —
          // the `return` above already ruled it out.
          const { gameState: restoredState, handFlags: restoredHandFlags } =
            unpackPersistedState(persistedState!);

          const playerMap = readPersistedPlayerMap(row.playerMap, row.playerIds);
          if (!Object.values(playerMap).includes(userId)) {
            socket.emit("game:rejoin_failed", { reason: "Not authorized", code: "UNAUTHORIZED", roomCode });
            return;
          }

          socket.join(roomCode);
          socketRoomMap.set(socket.id, roomCode);

          const restoredScores = (row.scores as Record<string, number>) ?? {};
          const restoredTarget = row.matchTarget ?? MATCH_TARGETS[0];
          const restoredResolution = resolveMatch(restoredScores, restoredTarget);
          const game: OnlineGameState = {
            roomId: roomCode,
            gameState: restoredState as GameState,
            playerMap,
            rematchVotes: new Set(),
            rematchIntents: new Map(),
            cumulativeScores: restoredScores,
            gameMode: row.gameMode === "teams" ? "teams" : "free_for_all",
            maxPlayers: row.maxPlayers,
            matchTarget: restoredTarget,
            matchLength: row.matchLength === "single" ? "single" : "match",
            matchOver:
              row.matchLength === "single"
                ? (restoredState as GameState).gameOver
                : !!restoredResolution && restoredResolution.newTarget === null,
            handFlags: restoredHandFlags,
            spectators: new Set<string>(),
            // The log is memory-only, so a hand restored after a restart has
            // none and produces no replay. The next hand starts a fresh one.
            moveLog: null,
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

          await emitRoomStateTo(socket, roomCode);

          socket.emit(
            "game:state",
            sanitizeStateForPlayer(game.gameState, userId, game.playerMap)
          );
          io.to(roomCode).emit("game:player_reconnected", {
            userId,
            username,
            code: "PLAYER_RECONNECTED",
            message: `${username} è rientrato.`,
            params: { username },
          });
          armTurn(roomCode);
          logger.info({ userId, roomCode }, "Player rejoined game (from DB)");
        } catch (err) {
          logger.error({ err, roomCode, userId }, "game:rejoin failed");
          socket.emit("game:rejoin_failed", { reason: "Errore del server", code: "SERVER_ERROR", roomCode });
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
        socket.join(roomId);
        socketRoomMap.set(socket.id, roomId);
        await emitRoomStateTo(socket, roomId);
        socket.emit(
          "game:state",
          sanitizeStateForPlayer(game.gameState, userId, game.playerMap)
        );
        io.to(roomId).emit("game:player_reconnected", { userId, username });
        armTurn(roomId);
        logger.info(
          { userId, username, roomId },
          "Player reconnected within grace period"
        );
        break;
      }
    }

    void emitFriendStatus(io, userId, true);

    try {
      const friends = await storage.getFriends(userId);
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

          clearAfkTimer(currentRoomId, userId);
          const game = activeGames.get(currentRoomId);

          if (!game || game.gameState.gameOver) {
            await handleLeaveRoom_lobby(io, currentRoomId, userId, username);
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
        const anyoneConnected = Object.values(game.playerMap).some((uid) =>
          userSocketMap.has(uid)
        );
        if (!anyoneConnected && game.gameState.gameOver) {
          disposeGame(roomId);
        }
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

async function handleLeaveRoom(
  io: SocketServer,
  socket: { id: string; leave: (r: string) => void; data?: { username?: string } },
  userId: string,
  username: string
) {
  const roomId = socketRoomMap.get(socket.id);
  if (!roomId) return;
  socketRoomMap.delete(socket.id);

  clearAllTimersForUser(userId, roomId);

  await storage.removeRoomPlayer(roomId, userId);
  socket.leave(roomId);

  const room = await storage.getRoomById(roomId);
  if (!room) return;

  if (room.status === "waiting") {
    const remaining = await storage.getRoomPlayers(roomId);
    if (remaining.length === 0) {
      await storage.updateRoomStatus(roomId, "finished");
      publicRoomIds.delete(roomId);
      return;
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
  } else if (room.status === "in_progress") {
    // Removing the DB row alone leaves the seat live in the in-memory game:
    // vacateSeat must also run, or the leaver's seat keeps receiving their
    // hand and auto-playing on their behalf.
    await vacateSeat(io, roomId, userId, socket.data?.username ?? username);
  }
}

async function handleLeaveRoom_lobby(
  io: SocketServer,
  roomId: string,
  userId: string,
  username: string
) {
  await storage
    .removeRoomPlayer(roomId, userId)
    .catch((err) =>
      logger.warn(
        { err, roomId, userId },
        "Failed to delete the room_players row after a lobby leave — the seat stays counted as taken"
      )
    );

  const room = await storage.getRoomById(roomId);
  if (!room) return;

  if (room.status === "waiting") {
    const remaining = await storage.getRoomPlayers(roomId);
    if (remaining.length === 0) {
      await storage.updateRoomStatus(roomId, "finished");
      publicRoomIds.delete(roomId);
      return;
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
            "Failed to update rooms.host_user_id after the host disconnected from the lobby"
          )
        );
    }
    io.to(roomId).emit(
      "room:state",
      roomStatePayload({ ...room, hostUserId: newHostId }, remaining)
    );
    io.to(roomId).emit("room:player_left", { userId, username });
  } else if (room.status === "finished") {
    const remaining = await storage.getRoomPlayers(roomId);
    if (remaining.length === 0) {
      await storage.updateRoomStatus(roomId, "finished");
      publicRoomIds.delete(roomId);
    }
  }
}

async function emitFriendStatus(
  io: SocketServer,
  userId: string,
  online: boolean
) {
  const friends = await storage.getFriends(userId).catch(() => []);
  // Abort if user disconnected while we were fetching friends
  if (online && !userSocketMap.has(userId)) return;
  friends.forEach((f) => {
    const friendSocket = userSocketMap.get(f.friend.id);
    if (friendSocket) {
      io.to(friendSocket).emit("friend:status", { userId, online });
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
