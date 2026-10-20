// server/socket/socketRooms.ts — everything a player does *before* a match starts:
// opening a room, joining one, watching one, leaving, and starting the game.
//
// Registration is synchronous and runs before the connection handler's first
// `await`, exactly as it did inline. Socket.IO drops a packet that arrives
// with no listener attached, and the client emits on its own `connect`.
import type { HandlerContext } from "./socketTypes.ts";
import { roomStore } from "../store/roomStore.ts";
import { trackEvent } from "./events.ts";
import { onEvent } from "./socketSafety.ts";
import { socketRoomMap, spectatorRoomMap } from "../game/gameRoom.ts";
import { clearLobbyGrace, seatHoldMs } from "../game/gameTimers.ts";
import { OK } from "../shared/refusal.ts";
import {
  handleSeatRelease,
  roomStatePayload,
  announceIfFilled,
  announceRoomChanged,
} from "./socketTable.ts";
import { seatSocket, stopSpectating } from "./seating.ts";
import {
  type LobbyPort,
  createRoomIntent,
  joinRoomIntent,
  quickmatchIntent,
  rejoinRoomIntent,
  setVisibilityIntent,
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

export function registerRoomHandlers({ rt, socket, userId }: HandlerContext) {

    const lobby: LobbyPort = {
      userId,
      socketId: socket.id,
      store: roomStore,
      watching: spectatorRoomMap,
      seat: (roomId) => seatSocket(rt, socket, userId, roomId),
      sendState: (state) => socket.emit("room:state", state),
      broadcastState: (roomId, state) => rt.out.room(roomId).emit("room:state", state),
      join: (roomId) => socket.join(roomId),
      leave: (roomId) => socket.leave(roomId),
      roomState: roomStatePayload,
      table: (draft) => rt.route(draft),
      announceFilled: (room, seated) => announceIfFilled(rt, room, seated),
      announceChanged: (roomId) => announceRoomChanged(rt, roomId),
      clearLobbyGrace,
      seatHoldMs,
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
        await stopSpectating(rt, socket, userId);
        return OK;
      },
      // Matches room:spectate: leaving cannot be cheaper to spam than joining.
      { limit: 10, windowMs: 60_000 }
    );

    onEvent(socket, "room:join", RoomJoinSchema, (p) => joinRoomIntent(lobby, p), {
      limit: 10,
      windowMs: 60_000,
    });

    // Without this the returning socket has no socketRoomMap entry, so every
    // later room event resolves to no room and is refused.
    onEvent(socket, "room:rejoin", RoomRejoinSchema, (p) => rejoinRoomIntent(lobby, p), {
      limit: 20,
      windowMs: 60_000,
    });

    onEvent(
      socket,
      "room:leave",
      NoPayloadSchema,
      async () => {
        const leavingRoomId = socketRoomMap.get(socket.id);
        if (!leavingRoomId) return OK;
        socketRoomMap.delete(socket.id);

        await handleSeatRelease(rt, leavingRoomId, userId, { socket, source: "leave" });
        return OK;
      },
      { limit: 20, windowMs: 60_000 }
    );

    onEvent(
      socket,
      "room:setVisibility",
      RoomSetVisibilitySchema,
      (p) => setVisibilityIntent(lobby, socketRoomMap.get(socket.id) ?? null, p),
      { limit: 20, windowMs: 60_000 }
    );

    onEvent(socket, "room:quickmatch", RoomQuickmatchSchema, (p) => quickmatchIntent(lobby, p), {
      limit: 10,
      windowMs: 60_000,
    });

    onEvent(
      socket,
      "room:start",
      RoomStartSchema,
      async ({ fillWithBots, botPersonality, matchLength }) => {
        const roomId = socketRoomMap.get(socket.id);
        if (!roomId) return { ok: false, code: "NOT_AT_A_TABLE" };
        // Routed like every other table action: between the rounds of a match
        // the game already exists, and it exists on whichever instance dealt
        // the last one rather than on whichever one is holding the host.
        return rt.route({
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
