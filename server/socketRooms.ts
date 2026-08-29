// server/socketRooms.ts — everything a player does *before* a hand starts:
// opening a room, joining one, watching one, leaving, and starting the game.
//
// Registration is synchronous and runs before the connection handler's first
// `await`, exactly as it did inline. Socket.IO drops a packet that arrives
// with no listener attached, and the client emits on its own `connect`.
import type { Server as SocketServer, Socket } from "socket.io";
import { storage } from "./storage.ts";
import { logger } from "./logger.ts";
import { trackEvent } from "./events.ts";
import { onEvent } from "./socketSafety.ts";
import {
  activeGames,
  seatOfUser,
  socketRoomMap,
  spectatorRoomMap,
} from "./gameRoom.ts";
import type { OnlineGameState } from "./gameRoom.ts";
import {
  clearLobbyGrace,
  clearRoomTimers,
  usersInLobbyGrace,
} from "./gameTimers.ts";
import { sendGameStateTo } from "./gamePersistence.ts";
import { buildSeatRoster } from "./onlineGameLogic.ts";
import { handleSeatRelease, roomStatePayload } from "./socketTable.ts";
import {
  NoPayloadSchema,
  RoomCreateSchema,
  RoomJoinSchema,
  RoomRejoinSchema,
  RoomSpectateSchema,
  RoomQuickmatchSchema,
  RoomStartSchema,
} from "./socketSchemas.ts";
import {
  initializeGame,
  targetsFor,
  teamForSeat,
  TEAMS_PLAYER_COUNT,
} from "../lib/gameEngine.ts";
import { startReplayLog } from "./replayShape.ts";
import { dealManche } from "./dealManche.ts";

export interface RoomHandlerContext {
  io: SocketServer;
  socket: Socket;
  userId: string;
  username: string;
}

export function registerRoomHandlers({ io, socket, userId, username }: RoomHandlerContext) {

    onEvent(
      socket,
      "room:create",
      RoomCreateSchema,
      async ({ gameMode, maxPlayers }) => {
        if (!teamsSizeAllowed(socket, gameMode, maxPlayers)) return;
        const room = await storage.createRoom(userId, gameMode, maxPlayers, "private");
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
        sendGameStateTo(io, userId, game);
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
          socket.emit("room:error", SEAT_CLAIM_REFUSAL[claim.reason]);
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
     * Coming back to a waiting lobby on a new socket. The seat row is the whole
     * proof of membership: it outlives a disconnect for LOBBY_GRACE_MS, so a
     * caller still holding one dropped and returned, and anyone else holding
     * the code is arriving, which is `room:join`.
     *
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
        if (!seated.some((p) => p.userId === userId)) {
          socket.emit("room:error", {
            message: "You are not in this room",
            code: "NOT_IN_ROOM",
          });
          return;
        }

        const claim = await storage.claimRoomSeat(room.id, userId);
        if (!claim.ok && claim.reason !== "already_joined") {
          socket.emit("room:error", SEAT_CLAIM_REFUSAL[claim.reason]);
          return;
        }

        socket.join(room.id);
        socketRoomMap.set(socket.id, room.id);
        clearLobbyGrace(room.id, userId);

        const players = await storage.getRoomPlayers(room.id);
        io.to(room.id).emit("room:state", roomStatePayload(room, players));
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
      },
      { limit: 20, windowMs: 60_000 }
    );

    onEvent(
      socket,
      "room:quickmatch",
      RoomQuickmatchSchema,
      async ({ maxPlayers, gameMode }) => {
        if (!teamsSizeAllowed(socket, gameMode, maxPlayers)) return;
        const waiting = await storage.findWaitingPublicRooms(userId);

        let joinedRoomId: string | null = null;
        for (const candidate of waiting) {
          if (candidate.containsUser) continue;
          // Nobody in it means nobody is coming: the row outlived the write
          // that should have closed it, and seating someone alone in it would
          // strand them in a lobby with a host who already left.
          if (candidate.playerCount === 0) continue;
          if (
            candidate.room.maxPlayers !== maxPlayers ||
            candidate.room.gameMode !== gameMode ||
            candidate.playerCount >= candidate.room.maxPlayers
          )
            continue;

          const claim = await storage.claimRoomSeat(candidate.room.id, userId);
          if (!claim.ok) continue;

          const roomId = candidate.room.id;
          socket.join(roomId);
          socketRoomMap.set(socket.id, roomId);

          const updatedPlayers = await storage.getRoomPlayers(roomId);
          io.to(roomId).emit(
            "room:state",
            roomStatePayload(candidate.room, updatedPlayers)
          );
          joinedRoomId = roomId;
          break;
        }

        if (!joinedRoomId) {
          const room = await storage.createRoom(userId, gameMode, maxPlayers, "public");
          await storage.addRoomPlayer(room.id, userId, 0);
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

        // A seat inside its grace is held for someone who is not here. Dealing
        // them a hand gives the table a player who cannot play it and whom no
        // disconnect can ever hand to a bot, because their disconnect already
        // happened. Release the seat instead; they can rejoin the next lobby.
        const seated = await storage.getRoomPlayers(room.id);
        const absent = new Set(usersInLobbyGrace(roomId));
        for (const p of seated.filter((p) => absent.has(p.userId))) {
          clearLobbyGrace(roomId, p.userId);
          await handleSeatRelease(io, roomId, p.userId, p.user.username, {
            source: "disconnect",
          });
        }
        const players = seated.filter((p) => !absent.has(p.userId));
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
        if (!teamsSizeAllowed(socket, room.gameMode, roster.length)) return;

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
        // Before the game exists, not after: `claimRoomSeat` re-reads the
        // status under its own row lock, so a room that is no longer `waiting`
        // cannot take a straggler. Leaving it to dealManche would open a
        // window the width of one round-trip in which quick-match can seat
        // someone into a hand whose roster is already frozen.
        await storage.updateRoomStatus(roomId, "in_progress");
        // Nobody can join this room now, so nobody should be looking at an
        // invitation to it. The read already filters on `waiting`, so this is
        // hygiene rather than the guarantee — hence logged, never thrown.
        void storage
          .clearGameInvites(roomId)
          .catch((err: unknown) =>
            logger.warn({ err, roomId }, "Failed to clear invites for a started room")
          );
        activeGames.set(roomId, newGame);

        // The room hears that it started, before anyone is sent their cards.
        // `game:state` is addressed to one player and carries both facts at
        // once — here is your hand, and the lobby is over — so a player who
        // misses theirs is left on the room screen with no way back: the room
        // id is only remembered once a `room:state` says `in_progress`, and
        // without it `game:rejoin` has nothing to ask about. This is a room
        // broadcast, so it does not depend on resolving any one player.
        io.to(roomId).emit(
          "room:state",
          roomStatePayload({ ...room, status: "in_progress" }, players)
        );

        await dealManche(io, newGame, gameState);
        logger.info(
          { roomId, playerCount: players.length, botCount: roster.length - players.length },
          "Game started"
        );
      },
      { limit: 10, windowMs: 60_000 }
    );
}

/**
 * Why a seat claim was refused, in the shape the wire carries it: a stable
 * `code` the client localises, and English fallback text for a client that
 * cannot.
 */
const SEAT_CLAIM_REFUSAL = {
  no_room: { message: "Room not found", code: "ROOM_NOT_FOUND" },
  not_waiting: { message: "Game already started", code: "GAME_ALREADY_STARTED" },
  full: { message: "Room full", code: "ROOM_FULL" },
  already_joined: { message: "You are already in the room", code: "ALREADY_IN_ROOM" },
} as const;

/**
 * Teams is the one mode with a fixed size, checked both where a room is sized
 * and where it is seated. Returns whether the caller may carry on; emits the
 * refusal itself when it may not.
 */
function teamsSizeAllowed(
  socket: Socket,
  gameMode: string,
  playerCount: number
): boolean {
  if (gameMode !== "teams" || playerCount === TEAMS_PLAYER_COUNT) return true;
  socket.emit("room:error", {
    message: "Teams mode needs exactly 4 players",
    code: "TEAMS_REQUIRE_FOUR",
  });
  return false;
}
