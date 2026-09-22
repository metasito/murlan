// server/socket/socketRooms.ts — everything a player does *before* a hand starts:
// opening a room, joining one, watching one, leaving, and starting the game.
//
// Registration is synchronous and runs before the connection handler's first
// `await`, exactly as it did inline. Socket.IO drops a packet that arrives
// with no listener attached, and the client emits on its own `connect`.
import type { SocketServer, GameSocket as Socket } from "./socketTypes.ts";
import { roomStore } from "../store/roomStore.ts";
import { trackEvent } from "./events.ts";
import { onEvent } from "./socketSafety.ts";
import { socketRoomMap, spectatorRoomMap } from "../game/gameRoom.ts";
import { clearLobbyGrace } from "../game/gameTimers.ts";
import { payload } from "./payload.ts";
import {
  handleSeatRelease,
  roomStatePayload,
  teamsSizeRefusal,
  announceIfFilled,
  announceRoomChanged,
} from "./socketTable.ts";
import { applyOrForward } from "../game/tableRouter.ts";
import { seatSocket, stopSpectating } from "./seating.ts";
import {
  type LobbyPort,
  SEAT_CLAIM_REFUSAL,
  createRoomIntent,
  joinRoomIntent,
  spectateRoomIntent,
} from "./lobbyIntents.ts";
import {
  NoPayloadSchema,
  RoomCreateSchema,
  RoomJoinSchema,
  RoomRejoinSchema,
  RoomSpectateSchema,
  RoomQuickmatchSchema,
  RoomSetVisibilitySchema,
  RoomStartSchema,
} from "../../shared/socketSchemas.ts";

export interface RoomHandlerContext {
  io: SocketServer;
  socket: Socket;
  userId: string;
}

export function registerRoomHandlers({ io, socket, userId }: RoomHandlerContext) {

    const lobby: LobbyPort = {
      userId,
      socketId: socket.id,
      store: roomStore,
      watching: spectatorRoomMap,
      seat: (roomId) => seatSocket(io, socket, userId, roomId),
      refuse: (refusal) => socket.emit("room:error", refusal),
      sendState: (state) => socket.emit("room:state", state),
      broadcastState: (roomId, state) => io.to(roomId).emit("room:state", state),
      join: (roomId) => socket.join(roomId),
      leave: (roomId) => socket.leave(roomId),
      roomState: roomStatePayload,
      table: (draft) => applyOrForward(io, draft),
      announceFilled: (room, seated) => announceIfFilled(io, room, seated),
      track: trackEvent,
    };

    onEvent(socket, "room:create", RoomCreateSchema, (p) => createRoomIntent(lobby, p), {
      limit: 5,
      windowMs: 60_000,
    });

    onEvent(socket, "room:spectate", RoomSpectateSchema, (p) => spectateRoomIntent(lobby, p), {
      limit: 10,
      windowMs: 60_000,
    });

    // Through onEvent like every other inbound event, not a bare socket.on.
    // It carries no payload, so validation is moot, but the rate limit and the
    // per-event error containment are not — and an event registered outside
    // the wrapper is exactly the one nobody remembers to check.
    onEvent(
      socket,
      "room:unspectate",
      NoPayloadSchema,
      async () => {
        await stopSpectating(io, socket, userId);
      },
      // Matches room:spectate: leaving cannot be cheaper to spam than joining.
      { limit: 10, windowMs: 60_000 }
    );

    onEvent(socket, "room:join", RoomJoinSchema, (p) => joinRoomIntent(lobby, p), {
      limit: 10,
      windowMs: 60_000,
    });

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
        const room = await roomStore.getRoomByCode(code.toUpperCase());
        if (!room) {
          socket.emit("room:error", payload("ROOM_NOT_FOUND"));
          return;
        }

        const seated = await roomStore.getRoomPlayers(room.id);
        if (!seated.some((p) => p.userId === userId)) {
          socket.emit("room:error", payload("NOT_IN_ROOM"));
          return;
        }

        const claim = await roomStore.claimRoomSeat(room.id, userId);
        if (!claim.ok && claim.reason !== "already_joined") {
          socket.emit("room:error", SEAT_CLAIM_REFUSAL[claim.reason]);
          return;
        }

        await seatSocket(io, socket, userId, room.id);
        clearLobbyGrace(room.id, userId);

        const players = await roomStore.getRoomPlayers(room.id);
        io.to(room.id).emit("room:state", await roomStatePayload(claim.room, players));
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

        await handleSeatRelease(io, leavingRoomId, userId, { socket, source: "leave" });
      },
      { limit: 20, windowMs: 60_000 }
    );

    // Making a room visible to strangers is the host's act and nobody else's,
    // so the seat that asked is checked against the row rather than against
    // whatever the client believes about who is hosting.
    onEvent(
      socket,
      "room:setVisibility",
      RoomSetVisibilitySchema,
      async ({ visibility }) => {
        const roomId = socketRoomMap.get(socket.id);
        if (!roomId) return { ok: false, code: "NOT_AT_A_TABLE" };

        const room = await roomStore.getRoomById(roomId);
        if (!room) {
          socket.emit("room:error", payload("ROOM_NOT_FOUND"));
          return { ok: false, code: "ROOM_NOT_FOUND" };
        }
        if (room.hostUserId !== userId) {
          socket.emit("room:error", payload("NOT_HOST"));
          return { ok: false, code: "NOT_HOST" };
        }
        if (room.status !== "waiting") {
          socket.emit("room:error", payload("GAME_ALREADY_STARTED"));
          return { ok: false, code: "GAME_ALREADY_STARTED" };
        }

        await roomStore.updateRoomVisibility(roomId, visibility);
        await announceRoomChanged(io, roomId);
        return { ok: true };
      },
      { limit: 20, windowMs: 60_000 }
    );

    onEvent(
      socket,
      "room:quickmatch",
      RoomQuickmatchSchema,
      async ({ maxPlayers, gameMode }) => {
        if (teamsSizeRefusal((p) => socket.emit("room:error", p), gameMode, maxPlayers)) return;

        const waiting = await roomStore.findWaitingPublicRooms(userId);

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

          const claim = await roomStore.claimRoomSeat(candidate.room.id, userId, {
            requirePublic: true,
            requireOccupied: true,
          });
          if (!claim.ok) continue;

          const roomId = candidate.room.id;
          await seatSocket(io, socket, userId, roomId);

          const updatedPlayers = await roomStore.getRoomPlayers(roomId);
          io.to(roomId).emit("room:state", await roomStatePayload(claim.room, updatedPlayers));
          await announceIfFilled(io, claim.room, updatedPlayers.length);
          joinedRoomId = roomId;
          break;
        }

        if (!joinedRoomId) {
          const room = await roomStore.createRoom(userId, gameMode, maxPlayers, "public", true);
          await roomStore.addRoomPlayer(room.id, userId, 0);
          await seatSocket(io, socket, userId, room.id);

          const players = await roomStore.getRoomPlayers(room.id);
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
          fillWithBots,
          botPersonality,
          matchLength,
        });
      },
      { limit: 10, windowMs: 60_000 }
    );
}
