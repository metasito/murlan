import { Server as SocketServer } from "socket.io";
import type { Socket } from "socket.io";
import type { IncomingMessage, Server as HttpServer } from "node:http";
import type { NextFunction, Request, Response } from "express";
import type { Session, SessionData } from "express-session";
import { eq } from "drizzle-orm";
import { storage } from "./storage.ts";
import { logger } from "./logger.ts";
import { DEFAULT_LOCALE, translate } from "../shared/i18n.ts";
import { trackEvent } from "./events.ts";
import { notifyUser } from "./push.ts";
import { sessionMiddleware } from "./session.ts";
import { db } from "./db.ts";
import { activeGames as activeGamesTable } from "../shared/schema.ts";
import { consumeSocketTicket } from "./ticket.ts";
import { isAllowedOrigin } from "./cors.ts";
import { allowSocketAction, onEvent } from "./socketSafety.ts";
import {
  activeGames,
  forgetLobbyDropout,
  lobbyDropouts,
  publicRoomIds,
  rememberLobbyDropout,
  seatOfUser,
  socketRoomMap,
  spectatorRoomMap,
  userSocketMap,
} from "./gameRoom.ts";
import type { OnlineGameState } from "./gameRoom.ts";
import {
  disconnectTimers,
  DISCONNECT_GRACE_MS,
  clearRoomTimers,
  clearAllTimersForUser,
} from "./gameTimers.ts";
import {
  broadcastGameState,
  disposeGame,
  gameOverWriters,
  persistGameState,
  safeTimer,
  sanitizeStateForPlayer,
  startSweeper,
} from "./gamePersistence.ts";
import {
  broadcastRematchIntents,
  handleGameOver,
  scoresByName,
  tableWantsRematch,
} from "./gameOver.ts";
import {
  armTurn,
  armTurnIfIdle,
  recordPlayFlags,
  vacateSeat,
} from "./gameTurn.ts";
import {
  buildSeatRoster,
  teamKeyMap,
  restoredMatchOver,
  unpackPersistedState,
} from "./onlineGameLogic.ts";
import {
  NoPayloadSchema,
  RoomCreateSchema,
  RoomJoinSchema,
  RoomRejoinSchema,
  RoomSpectateSchema,
  RoomQuickmatchSchema,
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
  canPlay,
  targetsFor,
} from "../lib/gameEngine.ts";
import type { GameState } from "../lib/gameEngine.ts";
import { appendReplayMove, startReplayLog } from "./replayShape.ts";
import { dealManche } from "./dealManche.ts";

/**
 * Handshakes one account may complete per minute. Socket.io answers
 * `/socket.io/*` before Express sees it, so no express-rate-limit instance
 * reaches the handshake. Matched to the ticket limiter's 60/min
 * (`server/routes.ts`), which mints one ticket per attempt — a smaller budget
 * locks a phone out of its own game while its connection flaps.
 */
const HANDSHAKES_PER_MINUTE = 60;

/**
 * Read once at module scope — same shape as authMaxFromEnv in routes.ts — so
 * a test process must set MURLAN_GAME_ACTION_RATE_LIMIT before this module
 * is first imported. Shared by game:play and game:pass: a suite replaying
 * several hands down one socket to reach a probabilistic phase needs
 * headroom a live session never does.
 */
function gameActionLimitFromEnv(): number {
  const parsed = Number(process.env.MURLAN_GAME_ACTION_RATE_LIMIT);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 60;
}
const GAME_ACTION_RATE_LIMIT = gameActionLimitFromEnv();
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
 * Throws an account off the server once its `users` row is gone: a socket
 * authenticates once and `socket.data.userId` is never re-checked.
 *
 * Call only after the delete has committed — releasing the seat can end the
 * hand, and the hand's writes must not race the transaction. Never throws.
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
 * The one internal a test cannot reach any other way: `_io` is private to this
 * module, and the containment property needs a timer body that throws on demand.
 */
export const __testables = {
  runTimerBody: (label: string, roomId: string, fn: () => void) =>
    safeTimer(_io, label, roomId, fn),
};

// ─── Server ───────────────────────────────────────────────────────────────────
/**
 * express-session types its attachment as always present. The handshake reaches
 * the auth guard whether the store answered or not.
 */
type HandshakeRequest = IncomingMessage & {
  session?: Session & Partial<SessionData>;
};

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

  // Inject session into socket requests. `next` is cast because express and
  // socket.io disagree about it, not about the session: express overloads it
  // with `"route"`/`"router"`, which socket.io's error-only signature rejects.
  io.use((socket, next) => {
    sessionMiddleware(socket.request as Request, {} as Response, next as NextFunction);
  });

  /**
   * Handshake auth: a valid session, or a valid unconsumed ticket. Nothing
   * else — accepting a bare `handshake.auth.userId` would let any client
   * connect as any user.
   */
  io.use(async (socket, next) => {
    try {
      const req = socket.request as HandshakeRequest;
      const sessionUserId = req.session?.userId;
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
    // Opening a socket is what reaching the online area does, so this is the
    // server's only sight of "got past the menu".
    trackEvent("lobby.entered", userId);
    if (replacedSocketId && replacedSocketId !== socket.id) {
      evictReplacedSession(io, userId, replacedSocketId, socket);
    }
    logger.debug({ userId, username, socketId: socket.id }, "Socket connected");

    // Every registration below must run before this function's first `await`.
    // Socket.io delivers packets the instant the transport is up, and a client
    // that emits from its own "connect" handler — OnlineGameContext fires
    // game:rejoin there — beats an `await` placed ahead of them. A packet with
    // no listener is dropped silently. The work that needs the database runs
    // after instead.
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
    // A spectator is a viewer with no seat, so sanitizeStateForPlayer already
    // blanks every hand for them and every game handler resolves the actor by
    // seat and returns. There is no spectator-specific path to get wrong.
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
        trackEvent("room.joined", userId, {
          playerCount: updatedPlayers.length,
          gameMode: room.gameMode,
        });
        io.to(room.id).emit("room:state", roomStatePayload(room, updatedPlayers));
      },
      { limit: 10, windowMs: 60_000 }
    );

    /**
     * Coming back to a waiting lobby on a new socket. Only for a caller who was
     * already in the room — a seat row that survived, or a `lobbyDropouts`
     * record; anyone else holding the code is joining, which is `room:join`.
     *
     * The host role goes back to the account that lost it and to nobody else.
     * Without this the returning socket has no socketRoomMap entry, so every
     * later room event resolves to no room and returns silently.
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
        // Engine seat index is the position in this roster, sorted by seat, and
        // playerMap is keyed the same way — so a gap in the DB seat numbering
        // cannot shift a hand onto the wrong player. Bot seats are left out of
        // playerMap, which armTurn already reads as "drive this seat with the AI".
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

        const [firstTarget] = targetsFor(roster.length);
        if (firstTarget === undefined) {
          throw new Error(`targetsFor(${roster.length}) returned no targets`);
        }

        const newGame: OnlineGameState = {
          gameState,
          playerMap,
          roomId,
          joinCode: room.code,
          rematchVotes: new Set(),
          rematchIntents: new Map(),
          cumulativeScores: previous?.cumulativeScores ?? {},
          gameMode: room.gameMode,
          maxPlayers: room.maxPlayers,
          matchTarget: previous?.matchTarget ?? firstTarget,
          matchLength: matchLength ?? previous?.matchLength ?? "match",
          matchOver: previous?.matchOver ?? false,
          handFlags: {},
          abandonedSeats: new Map<number, string>(),
          spectators: new Set<string>(),
          moveLog: startReplayLog(),
          dealFirstSeat: 0,
        };
        activeGames.set(roomId, newGame);

        publicRoomIds.delete(roomId);
        // The lobby is over; a seat lost from here on is the live game's to
        // hold open through the disconnect grace.
        lobbyDropouts.delete(roomId);

        await dealManche(io, newGame, gameState);
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
        if (cards.length !== unique.length) {
          socket.emit("game:error", { message: "Invalid card", code: "INVALID_CARD" });
          return;
        }

        const combo = buildCombination(cards);
        if (!combo) {
          socket.emit("game:error", { message: "Invalid combination", code: "INVALID_COMBINATION" });
          return;
        }

        const isNewRound = gameState.lastPlayedCombination === null;
        // Read before the engine sets it, so the transition is observable once
        // rather than on every play after it.
        const wasFirstPlay = !gameState.firstPlayMade;

        if (!gameState.firstPlayMade && gameState.startCard) {
          const startCardId = gameState.startCard.id;
          if (!combo.cards.some((c) => c.id === startCardId)) {
            const sc = gameState.startCard;
            socket.emit("game:error", {
              message: translate(DEFAULT_LOCALE, "server.MUST_PLAY_START_CARD", { rank: sc.rank }),
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

        if (wasFirstPlay && newState.firstPlayMade) {
          trackEvent("game.firstMoveMade", userId, {
            playerCount: newState.players.length,
            gameMode: newState.gameMode,
          });
        }

        if (newState.gameOver) {
          await handleGameOver(io, roomId, game, gameOverWriters);
        } else {
          armTurn(io, roomId);
        }
      },
      { limit: GAME_ACTION_RATE_LIMIT, windowMs: 60_000 }
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
        armTurn(io, roomId);
      },
      { limit: GAME_ACTION_RATE_LIMIT, windowMs: 60_000 }
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
        game.gameMode = room.gameMode;
        game.maxPlayers = room.maxPlayers;

        await dealManche(io, game, newGameState);
      },
      { limit: 20, windowMs: 60_000 }
    );

    onEvent(
      socket,
      "game:rejoin",
      GameRejoinSchema,
      async ({ roomId }) => {
        // onEvent's catch turns a throw into a generic `game:error`, which the
        // client's rejoin-failed handling never listens for. Every failure in
        // here must resolve as game:rejoin_failed instead, carrying { code,
        // message } — and `roomId` stays top-level, because the client's
        // stale-reply guard matches on it.
        try {
          const existingGame = activeGames.get(roomId);
          if (existingGame) {
            const seat = seatOfUser(existingGame, userId);
            if (seat === null) {
              socket.emit("game:rejoin_failed", { message: "Not authorized", code: "UNAUTHORIZED", roomId });
              return;
            }

            // Idempotent — an INSERT on every reconnect would pile up
            // duplicate room_players rows and corrupt the next rematch.
            await storage
              .upsertRoomPlayer(roomId, userId, seat)
              .catch((err: unknown) =>
                logger.warn({ err, roomId, userId }, "upsertRoomPlayer failed")
              );

            await rejoinSocketToTable(
              io,
              socket,
              userId,
              username,
              roomId,
              existingGame
            );
            logger.info({ userId, roomId }, "Player rejoined game (from memory)");
            return;
          }

          const row = await db.query.activeGames.findFirst({
            where: eq(activeGamesTable.roomId, roomId),
          });
          if (!row) {
            socket.emit("game:rejoin_failed", { message: "Game not found", code: "GAME_NOT_FOUND", roomId });
            return;
          }

          const restored = unpackPersistedState<GameState>(row.gameState);
          if (!restored.ok) {
            // Written under an older persisted shape, or holding a value the
            // restore path would carry straight into the engine. Restoring it
            // deals a silently corrupt hand rather than crashing, which is
            // worse than refusing outright.
            logger.warn(
              { roomId, reason: restored.reason },
              "Discarding unrestorable persisted game"
            );
            disposeGame(roomId);
            socket.emit("game:rejoin_failed", { message: "Game no longer valid", code: "GAME_NO_LONGER_VALID", roomId });
            return;
          }

          const { playerMap, scores, gameMode, matchLength, matchTarget, maxPlayers, isPublic } =
            restored.match;
          if (!Object.values(playerMap).includes(userId)) {
            socket.emit("game:rejoin_failed", { message: "Not authorized", code: "UNAUTHORIZED", roomId });
            return;
          }

          const restoredState = restored.gameState;
          const restoredPlayers = restoredState.players;
          const game: OnlineGameState = {
            roomId,
            joinCode: restored.joinCode,
            gameState: restoredState,
            playerMap,
            rematchVotes: new Set(),
            rematchIntents: new Map(),
            cumulativeScores: scores,
            gameMode,
            maxPlayers,
            matchTarget,
            matchLength,
            matchOver: restoredMatchOver({
              matchLength,
              gameMode,
              handOver: restoredState.gameOver,
              scores,
              target: matchTarget,
              teamOfKey: teamKeyMap(playerMap, restoredPlayers),
              playerCount: restoredPlayers.length,
            }),
            handFlags: restored.handFlags,
            // A hand restored after a restart has no record of who walked out
            // of it: the map is memory-only and the restart emptied it.
            abandonedSeats: new Map<number, string>(),
            spectators: new Set<string>(),
            // The log is memory-only, so a hand restored after a restart has
            // none and produces no replay. The next hand starts a fresh one.
            moveLog: null,
            dealFirstSeat: restored.dealFirstSeat,
          };
          activeGames.set(roomId, game);
          if (isPublic) publicRoomIds.add(roomId);
          logger.info({ roomId }, "Rehydrated activeGames from DB after restart");

          const seat = seatOfUser(game, userId);
          if (seat !== null) {
            await storage
              .upsertRoomPlayer(roomId, userId, seat)
              .catch((err: unknown) =>
                logger.warn({ err, roomId, userId }, "upsertRoomPlayer failed")
              );
          }

          await rejoinSocketToTable(io, socket, userId, username, roomId, game);
          logger.info({ userId, roomId }, "Player rejoined game (from DB)");
        } catch (err) {
          logger.error({ err, roomId, userId }, "game:rejoin failed");
          socket.emit("game:rejoin_failed", { message: "Server error", code: "SERVER_ERROR", roomId });
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
        armTurn(io, roomId);
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
            code: "FRIEND_INVITE",
            params: { username },
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
    } catch (err) {
      // Swallowing this silently leaves a connected account with no friends
      // list and no way to notice: the client is waiting for a push that is
      // never coming, and only a reconnect asks again.
      logger.warn({ err, userId }, "friend list read failed; this socket gets no online list");
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
          // Both exits below are correct and both are silent, so a seat that is
          // never released looks the same as one that was never held. Which of
          // the two ran is the whole diagnosis.
          if (!currentRoomId) {
            logger.debug({ userId, socketId: socket.id }, "Disconnect held no room");
            return;
          }

          // Still connected elsewhere — nothing to tear down.
          if (userSocketMap.has(userId)) {
            logger.debug(
              { userId, socketId: socket.id, currentRoomId, liveSocketId: userSocketMap.get(userId) },
              "Disconnect left another socket for the account"
            );
            return;
          }

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

          // Distinct from losing: the hand was still running when they went.
          trackEvent("game.abandoned", userId, {
            playerCount: game.gameState.players.length,
            gameMode: game.gameState.gameMode,
          });

          const graceSeconds = Math.round(DISCONNECT_GRACE_MS / 1000);
          io.to(currentRoomId).emit("game:player_disconnected", {
            userId,
            username,
            code: "PLAYER_DISCONNECTED_GRACE",
            // The grace period is configurable, so the number has to come from
            // the same constant the timer below is armed with — a hardcoded
            // "60 seconds" in the text is a promise the server may not keep.
            message: `${username} disconnected. They have ${graceSeconds} seconds to rejoin.`,
            params: { username, seconds: graceSeconds },
          });

          // A vacant seat must keep playing while we wait, or the table stalls
          // for a full minute on this player's turn.
          armTurn(io, currentRoomId);

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

  startSweeper(io);

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

/** The seats of a running table in the shape `room_players` reads back. */
function seatedHumansOf(game: OnlineGameState) {
  return game.gameState.players.flatMap((player, seatIndex) => {
    const seatUserId = game.playerMap[seatIndex];
    return seatUserId
      ? [{ seatIndex, userId: seatUserId, user: { username: player.name } }]
      : [];
  });
}

/**
 * The room as the live game knows it, for when the `rooms` row cannot be read.
 * `joinCode` rides in the persisted envelope so this survives a restart.
 */
function roomOf(game: OnlineGameState) {
  return {
    id: game.roomId,
    code: game.joinCode,
    hostUserId: game.playerMap[0] ?? null,
    status: "in_progress",
    gameMode: game.gameMode,
    maxPlayers: game.maxPlayers,
  };
}

/**
 * Re-sends `room:state` to a single rejoining socket. The client's only route
 * back into the game screen is `room` -> `/(online)/room` -> `gameState` ->
 * `/(online)/game`, so replying with `game:state` alone strands the player on
 * the lobby holding a live hand. A failed roster read must cost the roster and
 * not the reply.
 */
async function emitRoomStateTo(socket: Socket, roomId: string, game: OnlineGameState) {
  const room = await storage.getRoomById(roomId).catch((err: unknown) => {
    logger.warn({ err, roomId }, "getRoomById failed; answering from the live game");
    return undefined;
  });
  const players = await storage.getRoomPlayers(roomId).catch((err: unknown) => {
    logger.warn({ err, roomId }, "getRoomPlayers failed; answering from the live roster");
    return [];
  });
  // A running game always seats at least one human, so an empty roster is the
  // rows being gone rather than the table being empty.
  socket.emit(
    "room:state",
    roomStatePayload(room ?? roomOf(game), players.length > 0 ? players : seatedHumansOf(game))
  );
}

/**
 * Puts a socket back at a table it holds a seat at.
 *
 * The one emitter of `game:player_reconnected`, so its payload cannot differ
 * between the two paths that reach it. The caller owns the seat check and the
 * `room_players` row — the grace-timer path still holds one, the rejoin path
 * may not.
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

  // Caught, not propagated: the handler's blanket catch would turn a failed
  // roster refresh into a SERVER_ERROR that forfeits a live game.
  await emitRoomStateTo(socket, roomId, game).catch((err: unknown) =>
    logger.warn({ err, roomId, userId }, "emitRoomStateTo failed")
  );
  socket.emit(
    "game:state",
    sanitizeStateForPlayer(game.gameState, userId, game.playerMap, game.turnDeadlineMs)
  );
  // The client reads this as the framing of a manche that has just begun and
  // zeroes the match verdict and the rematch tally along with it, so it is
  // only right while one is running — at the results screen `game:over` and
  // `game:rematch_intents` own those.
  if (!game.gameState.gameOver) {
    socket.emit("game:match_state", {
      target: game.matchTarget,
      length: game.matchLength,
      scores: scoresByName(game),
    });
  }
  io.to(roomId).emit("game:player_reconnected", {
    userId,
    username,
    code: "PLAYER_RECONNECTED",
    message: `${username} is back.`,
    params: { username },
  });
  armTurnIfIdle(io, roomId);
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
 * Releases a seat: the room_players row, the user's timers, and the seat in a
 * live game. A `room:leave` and a lost connection differ only in what the
 * caller can hand over, so the seat-side work lives in one place.
 *
 * Runs on the disconnect path inside a `void (async () => …)`, so every storage
 * call is `.catch`-guarded: an unguarded throw there strands the room.
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
      const [nextHost] = remaining.sort((a, b) => a.seatIndex - b.seatIndex);
      if (!nextHost) throw new Error(`releaseSeat: room ${roomId} has no remaining players to host`);
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
  } else if (activeGames.has(roomId)) {
    // `rooms.status` reads "finished" between manches too, so only the
    // in-memory game knows whether the seat is still held. Removing the DB row
    // alone leaves it live — auto-playing the leaver's hand, or blocking the
    // rematch gate.
    await vacateSeat(io, roomId, userId, username);
  }
}

/**
 * Enforces one live socket per account: the newest connection keeps it.
 *
 * `userSocketMap` must already name the new socket — the replaced socket's
 * disconnect handler reads it and then declines to act, so the room
 * association has to move with the account or nothing releases the seat.
 *
 * The client stops reconnecting on this code (`context/SocketContext.tsx`):
 * socket.io retries forever, so two tabs would evict each other indefinitely.
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
    message: "Your account was opened somewhere else. This session has been closed.",
  });
  logger.info(
    { userId, replacedSocketId },
    "Session replaced by a newer connection for the same account"
  );
  replaced.disconnect(true);
}

/** Takes the friend rows rather than reading them: the connection handler pays
 *  for one `getFriends`, not two. */
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
  // Debounced, and re-checked after every await: a reconnect inside any of
  // these windows must cancel the offline notice rather than race it.
  await new Promise((resolve) => setTimeout(resolve, 400));
  if (userSocketMap.has(userId)) return;
  const friends = await storage.getFriends(userId).catch(() => []);
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
