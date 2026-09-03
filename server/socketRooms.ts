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
import { socketRoomMap, spectatorRoomMap } from "./gameRoom.ts";
import { clearLobbyGrace } from "./gameTimers.ts";
import {
  handleSeatRelease,
  roomStatePayload,
  teamsSizeRefusal,
  announceIfFilled,
} from "./socketTable.ts";
import { applyOrForward } from "./tableRouter.ts";
import {
  NoPayloadSchema,
  RoomCreateSchema,
  RoomJoinSchema,
  RoomRejoinSchema,
  RoomSpectateSchema,
  RoomQuickmatchSchema,
  RoomStartSchema,
} from "./socketSchemas.ts";

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
        if (teamsSizeRefusal((p) => socket.emit("room:error", p), gameMode, maxPlayers)) return;
        const room = await storage.createRoom(userId, gameMode, maxPlayers, "private");
        await storage.addRoomPlayer(room.id, userId, 0);

        socket.join(room.id);
        socketRoomMap.set(socket.id, room.id);

        const players = await storage.getRoomPlayers(room.id);
        socket.emit("room:state", await roomStatePayload(room, players));
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
          return { ok: false, code: "ROOM_NOT_FOUND" };
        }

        const admitted = await applyOrForward(io, {
          kind: "spectate",
          roomId: room.id,
          userId,
          username,
        });
        if (!admitted.ok) {
          socket.emit(
            "room:error",
            admitted.code === "ALREADY_IN_ROOM"
              ? { message: "You are already at the table", code: "ALREADY_IN_ROOM" }
              : { message: "Game not found", code: "GAME_NOT_FOUND" }
          );
          return admitted;
        }

        const previous = spectatorRoomMap.get(socket.id);
        if (previous && previous !== room.id) {
          await applyOrForward(io, { kind: "unspectate", roomId: previous, userId, username });
          socket.leave(previous);
        }
        spectatorRoomMap.set(socket.id, room.id);
        socket.join(room.id);
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
      async () => {
        const roomId = spectatorRoomMap.get(socket.id);
        if (!roomId) return;
        spectatorRoomMap.delete(socket.id);
        socket.leave(roomId);
        await applyOrForward(io, { kind: "unspectate", roomId, userId, username });
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
        io.to(room.id).emit("room:state", await roomStatePayload(room, updatedPlayers));
        await announceIfFilled(io, room, updatedPlayers.length);
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
        io.to(room.id).emit("room:state", await roomStatePayload(room, players));
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
        if (teamsSizeRefusal((p) => socket.emit("room:error", p), gameMode, maxPlayers)) return;

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
            await roomStatePayload(candidate.room, updatedPlayers)
          );
          await announceIfFilled(io, candidate.room, updatedPlayers.length);
          joinedRoomId = roomId;
          break;
        }

        if (!joinedRoomId) {
          const room = await storage.createRoom(userId, gameMode, maxPlayers, "public");
          await storage.addRoomPlayer(room.id, userId, 0);
          socket.join(room.id);
          socketRoomMap.set(socket.id, room.id);

          const players = await storage.getRoomPlayers(room.id);
          socket.emit("room:state", await roomStatePayload(room, players));
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
        if (!roomId) return { ok: false, code: "NOT_AT_A_TABLE" };
        // Routed like every other table action: between the manches of a match
        // the game already exists, and it exists on whichever instance dealt
        // the last one rather than on whichever one is holding the host.
        return applyOrForward(io, {
          kind: "startMatch",
          roomId,
          userId,
          username,
          fillWithBots,
          botPersonality,
          matchLength,
        });
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
  held: { message: "Every free seat is being held for a friend", code: "SEAT_HELD" },
  already_joined: { message: "You are already in the room", code: "ALREADY_IN_ROOM" },
} as const;
