import { Server as SocketServer } from "socket.io";
import type { Socket } from "socket.io";
import type { Server as HttpServer } from "node:http";
import { eq } from "drizzle-orm";
import { storage } from "./storage.ts";
import { logger } from "./logger.ts";
import { sessionMiddleware } from "./session.ts";
import { db } from "./db.ts";
import { activeGames as activeGamesTable } from "../shared/schema.ts";
import { consumeSocketTicket } from "./ticket.ts";
import { isAllowedOrigin } from "./cors.ts";
import { onEvent } from "./socketSafety.ts";
import {
  readPersistedPlayerMap,
  seatOfUser as seatOfUserInMap,
  scoreKeyForSeat as scoreKeyForMapSeat,
  findViewerSeat,
  excludeBotSeats,
  GAME_SCHEMA_VERSION,
  isStaleSchema,
} from "./onlineGameLogic.ts";
import {
  NoPayloadSchema,
  RoomCreateSchema,
  RoomJoinSchema,
  RoomQuickmatchSchema,
  RoomSetGameModeSchema,
  GamePlaySchema,
  GameRejoinSchema,
  GameReactionSchema,
  GameExchangeGiveCardSchema,
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
  resolveMatch,
  MATCH_TARGETS,
} from "../lib/gameEngine.ts";
import type { GameState, Card, GameMode } from "../lib/gameEngine.ts";

interface OnlineGameState {
  gameState: GameState;
  /** engine seat index -> userId. A missing seat is a vacated (bot) seat. */
  playerMap: Record<number, string>;
  roomId: string;
  rematchVotes: Set<string>;
  /** userId (or `bot:<seat>`) -> cumulative match points. */
  cumulativeScores: Record<string, number>;
  gameMode: GameMode;
  maxPlayers: number;
  matchTarget: number;
  matchOver: boolean;
}

const activeGames = new Map<string, OnlineGameState>();
const socketRoomMap = new Map<string, string>();
const userSocketMap = new Map<string, string>();
const publicRoomIds = new Set<string>();

// Timers. Every entry added here has exactly one matching delete — see
// clearAfkTimer / clearRoomTimers / clearAllTimersForUser / disposeGame.
const afkTimers = new Map<string, ReturnType<typeof setTimeout>>();
const disconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
const botTimers = new Map<string, ReturnType<typeof setTimeout>>();

const AFK_TIMEOUT_MS = 30_000;
const DISCONNECT_GRACE_MS = 60_000;
const BOT_MOVE_DELAY_MS = 1_200;
const SWEEP_INTERVAL_MS = 5 * 60_000;

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
    autoMoveForSeat({ gameState: state } as OnlineGameState, seat, useAi),
  readPersistedPlayerMap: (storedMap: unknown, storedIds: unknown) =>
    readPersistedPlayerMap(storedMap, storedIds),
};

function sanitizeStateForPlayer(
  state: GameState,
  viewerUserId: string,
  playerMap: Record<number, string>
) {
  // The client used to derive "which seat am I" from the lobby `room` object,
  // which is null across a cold-start rejoin and defaulted to seat 0 — every
  // player believed they were seat 0. The server already knows the answer
  // authoritatively; ship it with every state instead of making the client
  // guess.
  const viewerSeatIndex = findViewerSeat(playerMap, viewerUserId);
  return {
    ...state,
    viewerSeatIndex,
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
  const persistedState = {
    ...game.gameState,
    schemaVersion: GAME_SCHEMA_VERSION,
  };
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
    updatedAt: new Date(),
  };
  db.insert(activeGamesTable)
    .values(values)
    .onConflictDoUpdate({
      target: activeGamesTable.roomCode,
      // Everything mutable is refreshed: seats, scores, mode and player list
      // used to be written once and never updated, so a restored game came
      // back as a free-for-all with the wrong seats and no scoreboard.
      set: {
        gameState: values.gameState,
        playerIds: values.playerIds,
        playerMap: values.playerMap,
        scores: values.scores,
        isPublic: values.isPublic,
        maxPlayers: values.maxPlayers,
        gameMode: values.gameMode,
        matchTarget: values.matchTarget,
        updatedAt: values.updatedAt,
      },
    })
    .catch((err: unknown) =>
      logger.error({ err, roomId }, "Failed to persist game state")
    );
}

function broadcastGameState(io: SocketServer, game: OnlineGameState) {
  const { gameState, playerMap } = game;
  Object.values(playerMap).forEach((uid) => {
    const playerSocket = userSocketMap.get(uid);
    if (playerSocket) {
      io.to(playerSocket).emit(
        "game:state",
        sanitizeStateForPlayer(gameState, uid, playerMap)
      );
    }
  });
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
    if (combo) return processPlay(state, combo);
    if (!isNewRound) return processPass(state);
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
    return combo ? processPlay(state, combo) : null;
  }

  return processPass(state);
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
      message: "Partita interrotta: un posto vuoto non può giocare.",
    });
    void storage.updateRoomStatus(roomId, "finished").catch(() => {});
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
      // Only announce when something actually happened — the timer used to
      // announce even when it had returned early having done nothing.
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
 * the table can always continue — previously the seat was deleted from
 * playerMap while its cards remained, and the table deadlocked as soon as the
 * turn came round to it.
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
      await storage.updateRoomStatus(roomId, "finished").catch(() => {});
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
    await storage.updateRoomStatus(roomId, "finished").catch(() => {});
    disposeGame(roomId);
    return;
  }

  // The table survives with a bot in this seat — everyone else keeps
  // playing. This must NOT be `game:player_left`: that event drives the
  // client's "Partita interrotta" teardown, which used to fire here too and
  // eject every remaining human from a game the server was keeping alive.
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

  const resolution = resolveMatch(game.cumulativeScores, game.matchTarget);
  let matchWinners: string[] = [];
  let isDraw = false;
  if (resolution) {
    if (resolution.newTarget !== null) {
      game.matchTarget = resolution.newTarget;
    } else {
      game.matchOver = true;
      isDraw = resolution.isDraw;
      matchWinners = resolution.winners;
    }
  }

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
    matchOver: game.matchOver,
    matchWinners: winnerNames,
    isDraw,
  });

  if (game.matchOver) {
    io.to(roomId).emit("game:match_over", {
      target: game.matchTarget,
      isDraw,
      winners: winnerNames,
    });
  }

  await storage.updateRoomStatus(roomId, "finished").catch(() => {});
  // The row is kept (not deleted) so a restart between hands restores the
  // running match instead of silently resetting the scoreboard.
  persistGameState(roomId, game);
}

/** Between hands: a finished match starts over, an unfinished one carries on. */
function rollMatchForward(game: OnlineGameState) {
  if (game.matchOver) {
    game.cumulativeScores = {};
    game.matchTarget = MATCH_TARGETS[0];
    game.matchOver = false;
  }
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
   * else — a bare `handshake.auth.userId` used to be accepted, which let any
   * client connect as any user.
   */
  io.use(async (socket, next) => {
    try {
      const req = socket.request as any;
      const sessionUserId = req.session?.userId as string | undefined;
      const claimedUserId =
        sessionUserId ?? consumeSocketTicket(socket.handshake.auth?.ticket);

      if (!claimedUserId) return next(new Error("Non autenticato"));

      const user = await storage.getUser(claimedUserId).catch(() => null);
      if (!user) return next(new Error("Non autenticato"));

      socket.data.userId = user.id;
      socket.data.username = user.username;
      return next();
    } catch (err) {
      logger.error({ err }, "Socket handshake failed");
      return next(new Error("Non autenticato"));
    }
  });

  io.on("connection", async (socket: Socket) => {
    const userId = socket.data.userId as string;
    const username = socket.data.username as string;
    userSocketMap.set(userId, socket.id);
    logger.debug({ userId, username, socketId: socket.id }, "Socket connected");

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

    onEvent(
      socket,
      "room:join",
      RoomJoinSchema,
      async ({ code }) => {
        const room = await storage.getRoomByCode(code.toUpperCase());
        if (!room) {
          socket.emit("room:error", { message: "Stanza non trovata", code: "ROOM_NOT_FOUND" });
          return;
        }
        if (room.status !== "waiting") {
          socket.emit("room:error", { message: "Partita già iniziata", code: "GAME_ALREADY_STARTED" });
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
            message: "Non puoi cambiare modalità a partita iniziata",
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
      NoPayloadSchema,
      async () => {
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
        if (players.length < 2) {
          socket.emit("room:error", { message: "Servono almeno 2 giocatori", code: "MIN_PLAYERS_REQUIRED" });
          return;
        }

        const previous = activeGames.get(roomId);
        clearRoomTimers(roomId);

        // Engine seat index is the position in this ordered list. playerMap is
        // keyed the same way, so a gap in the DB seat numbering can never
        // shift a hand onto the wrong player.
        const playerSetup = players.map((p, idx) => ({
          name: p.user.username,
          type: "human" as const,
          team:
            room.gameMode === "teams"
              ? ((idx % 2 === 0 ? "A" : "B") as "A" | "B")
              : undefined,
        }));

        const gameState = initializeGame(playerSetup, room.gameMode);
        const playerMap: Record<number, string> = {};
        players.forEach((p, idx) => {
          playerMap[idx] = p.userId;
        });

        const newGame: OnlineGameState = {
          gameState,
          playerMap,
          roomId,
          rematchVotes: new Set(),
          cumulativeScores: previous?.cumulativeScores ?? {},
          gameMode: room.gameMode,
          maxPlayers: room.maxPlayers,
          matchTarget: previous?.matchTarget ?? MATCH_TARGETS[0],
          matchOver: previous?.matchOver ?? false,
        };
        rollMatchForward(newGame);
        activeGames.set(roomId, newGame);

        publicRoomIds.delete(roomId);
        await storage.updateRoomStatus(roomId, "in_progress");

        broadcastGameState(io, newGame);
        io.to(roomId).emit("game:started");
        io.to(roomId).emit("game:match_state", {
          target: newGame.matchTarget,
          scores: newGame.cumulativeScores,
        });

        persistGameState(roomId, newGame);
        armTurn(roomId);
        logger.info({ roomId, playerCount: players.length }, "Game started");
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
            message: "Devi prima completare lo scambio",
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
          socket.emit("game:error", { message: "Combinazione non valida", code: "INVALID_COMBINATION" });
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
          socket.emit("game:error", { message: "Mossa non valida", code: "INVALID_MOVE" });
          return;
        }

        const newState = processPlay(gameState, combo);
        game.gameState = newState;

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
            message: "Devi prima completare lo scambio",
            code: "EXCHANGE_PENDING",
          });
          return;
        }

        const currentIdx = gameState.currentTurnIndex;
        if (playerMap[currentIdx] !== userId) return;
        if (gameState.lastPlayedCombination === null) {
          socket.emit("game:error", { message: "Non puoi passare", code: "CANNOT_PASS" });
          return;
        }

        game.gameState = processPass(gameState);

        broadcastGameState(io, game);
        persistGameState(roomId, game);
        armTurn(roomId);
      },
      { limit: 60, windowMs: 60_000 }
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
        rollMatchForward(game);

        await storage.updateRoomStatus(roomId, "in_progress");

        broadcastGameState(io, game);
        io.to(roomId).emit("game:started");
        io.to(roomId).emit("game:match_state", {
          target: game.matchTarget,
          scores: game.cumulativeScores,
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
              socket.emit("game:rejoin_failed", { reason: "Non autorizzato", code: "UNAUTHORIZED", roomCode });
              return;
            }

            socket.join(roomCode);
            socketRoomMap.set(socket.id, roomCode);
            // Idempotent: this used to INSERT on every reconnect, piling up
            // duplicate room_players rows that corrupted the next rematch.
            await storage
              .upsertRoomPlayer(roomCode, userId, seat)
              .catch((err: unknown) =>
                logger.warn({ err, roomCode, userId }, "upsertRoomPlayer failed")
              );

            // room:state is what the client's navigation chain
            // (index -> room -> game) actually gates on. Replying with
            // game:state alone used to leave `room` null forever.
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
            });
            armTurn(roomCode);
            logger.info({ userId, roomCode }, "Player rejoined game (from memory)");
            return;
          }

          const row = await db.query.activeGames.findFirst({
            where: eq(activeGamesTable.roomCode, roomCode),
          });
          if (!row) {
            socket.emit("game:rejoin_failed", { reason: "Partita non trovata", code: "GAME_NOT_FOUND", roomCode });
            return;
          }

          const persistedState = row.gameState as
            | (GameState & { schemaVersion?: number })
            | null;
          if (isStaleSchema(persistedState)) {
            // Written under an older persisted shape (e.g. the pre-full-deck
            // 13-card deal). Restoring it deals a silently corrupt hand
            // rather than crashing, which is worse than refusing outright.
            logger.warn(
              { roomCode, foundVersion: persistedState?.schemaVersion },
              "Discarding stale persisted game (schema mismatch)"
            );
            disposeGame(roomCode);
            socket.emit("game:rejoin_failed", { reason: "Partita non più valida", code: "GAME_NO_LONGER_VALID", roomCode });
            return;
          }
          // isStaleSchema is a plain boolean helper (kept dependency-free for
          // unit testing), so TS can't narrow the null case through it —
          // the `return` above already ruled it out.
          const { schemaVersion: _schemaVersion, ...restoredState } = persistedState!;

          const playerMap = readPersistedPlayerMap(row.playerMap, row.playerIds);
          if (!Object.values(playerMap).includes(userId)) {
            socket.emit("game:rejoin_failed", { reason: "Non autorizzato", code: "UNAUTHORIZED", roomCode });
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
            cumulativeScores: restoredScores,
            gameMode: row.gameMode === "teams" ? "teams" : "free_for_all",
            maxPlayers: row.maxPlayers,
            matchTarget: restoredTarget,
            matchOver:
              !!restoredResolution && restoredResolution.newTarget === null,
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
          io.to(roomCode).emit("game:player_reconnected", { userId, username });
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
          socket.emit("game:error", { message: "Carta non valida", code: "INVALID_CARD" });
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
        // Invites were unauthenticated broadcast primitives: any user could
        // spam any userId. Only accepted friends, and only a few per minute.
        const areFriends = await storage.areFriends(userId, friendUserId);
        if (!areFriends) {
          socket.emit("friend:error", { message: "Non siete amici", code: "NOT_FRIENDS" });
          return;
        }
        const friendSocket = userSocketMap.get(friendUserId);
        if (!friendSocket) return;
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

    // ── Disconnect ───────────────────────────────────────────────────────────

    socket.on("disconnect", () => {
      void (async () => {
        try {
          // Only blank the mapping if it still points at THIS socket: a second
          // tab or a fast reconnect would otherwise black out the live one.
          if (userSocketMap.get(userId) === socket.id) {
            userSocketMap.delete(userId);
          }
          logger.debug({ userId, socketId: socket.id }, "Socket disconnected");

          await storage.updateLastSeen(userId).catch(() => {});

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

          io.to(currentRoomId).emit("game:player_disconnected", {
            userId,
            username,
            code: "PLAYER_DISCONNECTED_GRACE",
            message: `${username} si è disconnesso. Ha 60 secondi per rientrare.`,
            params: { username },
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
                  .catch(() => {});
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
      return "Stanza non trovata";
    case "not_waiting":
      return "Partita già iniziata";
    case "full":
      return "Stanza piena";
    case "already_joined":
      return "Sei già nella stanza";
  }
}

// Stable code counterpart to seatClaimMessage's Italian text, so the client
// can localise the same rejection reason (see docs on the `code` field above).
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
      for (const roomId of Array.from(publicRoomIds)) {
        void storage
          .getRoomById(roomId)
          .then((room) => {
            if (!room || room.status !== "waiting") publicRoomIds.delete(roomId);
          })
          .catch(() => {});
      }
    } catch (err) {
      logger.error({ err }, "Sweeper failed");
    }
  }, SWEEP_INTERVAL_MS);
  sweeper.unref?.();
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
      await storage.updateRoomHost(roomId, newHostId).catch(() => {});
    }
    io.to(roomId).emit(
      "room:state",
      roomStatePayload({ ...room, hostUserId: newHostId }, remaining)
    );
  } else if (room.status === "in_progress") {
    // Leaving mid-game used to remove the DB row but keep the seat, so the
    // leaver went on receiving their hand and their seat kept auto-playing.
    await vacateSeat(io, roomId, userId, socket.data?.username ?? username);
  }
}

async function handleLeaveRoom_lobby(
  io: SocketServer,
  roomId: string,
  userId: string,
  username: string
) {
  await storage.removeRoomPlayer(roomId, userId).catch(() => {});

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
      await storage.updateRoomHost(roomId, newHostId).catch(() => {});
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
