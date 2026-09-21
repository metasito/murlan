// server/lobbyIntents.ts — the decisions behind room:create, room:join and
// room:spectate, with every effect passed in as a port so `node --test` can
// drive them with no socket and no Postgres. Not a TableAction: those route to
// the instance holding a live game, and a lobby has no game to hold.
import type { roomStore } from "./roomStore.ts";
import type { roomStatePayload, announceIfFilled } from "./socketTable.ts";
import type { applyOrForward } from "./tableRouter.ts";
import type { TableActionDraft } from "./tableActions.ts";
import type { trackEvent } from "./events.ts";
import type { EventOutcome } from "./socketSafety.ts";
import type { WireRoomState } from "../shared/protocol.ts";
import type { z } from "zod";
import type { RoomCreateSchema, RoomJoinSchema } from "./socketSchemas.ts";
import { teamsSizeRefusal } from "./socketTable.ts";
import { logger } from "./logger.ts";
import { payload } from "./payload.ts";

export interface LobbyPort {
  userId: string;
  socketId: string;
  store: Pick<
    typeof roomStore,
    "createRoom" | "addRoomPlayer" | "getRoomPlayers" | "getRoomByCode" | "claimRoomSeat"
  >;
  /** `socketRoomMap` and `spectatorRoomMap`. */
  seats: Map<string, string>;
  watching: Map<string, string>;
  refuse(refusal: { message: string; code: string }): void;
  sendState(state: WireRoomState): void;
  broadcastState(roomId: string, state: WireRoomState): void;
  join(roomId: string): void;
  leave(roomId: string): void;
  roomState: typeof roomStatePayload;
  table(draft: TableActionDraft): ReturnType<typeof applyOrForward>;
  announceFilled(room: Parameters<typeof announceIfFilled>[1], seated: number): Promise<void>;
  track: typeof trackEvent;
}

/**
 * Why a seat claim was refused, in the shape the wire carries it: a stable
 * `code` the client localises, and English fallback text for a client that
 * cannot.
 */
export const SEAT_CLAIM_REFUSAL = {
  no_room: payload("ROOM_NOT_FOUND"),
  not_waiting: payload("GAME_ALREADY_STARTED"),
  full: payload("ROOM_FULL"),
  held: payload("SEAT_HELD"),
  already_joined: payload("ALREADY_IN_ROOM"),
  not_public: payload("ROOM_NOT_FOUND"),
  empty: payload("ROOM_NOT_FOUND"),
};

export async function createRoomIntent(
  port: LobbyPort,
  { gameMode, maxPlayers }: z.infer<typeof RoomCreateSchema>
): Promise<void> {
  if (teamsSizeRefusal(port.refuse, gameMode, maxPlayers)) return;
  const room = await port.store.createRoom(port.userId, gameMode, maxPlayers, "private");
  await port.store.addRoomPlayer(room.id, port.userId, 0);

  port.join(room.id);
  port.seats.set(port.socketId, room.id);

  const players = await port.store.getRoomPlayers(room.id);
  port.sendState(await port.roomState(room, players));
  logger.info({ roomId: room.id, userId: port.userId }, "Room created");
}

export async function joinRoomIntent(port: LobbyPort, { code }: z.infer<typeof RoomJoinSchema>): Promise<void> {
  const room = await port.store.getRoomByCode(code.toUpperCase());
  if (!room) {
    port.refuse(payload("ROOM_NOT_FOUND"));
    return;
  }
  if (room.status !== "waiting") {
    port.refuse(payload("GAME_ALREADY_STARTED"));
    return;
  }

  const claim = await port.store.claimRoomSeat(room.id, port.userId);
  if (!claim.ok) {
    port.refuse(SEAT_CLAIM_REFUSAL[claim.reason]);
    return;
  }

  port.join(room.id);
  port.seats.set(port.socketId, room.id);

  const updatedPlayers = await port.store.getRoomPlayers(room.id);
  port.track("room.joined", port.userId, {
    playerCount: updatedPlayers.length,
    gameMode: claim.room.gameMode,
  });
  port.broadcastState(room.id, await port.roomState(claim.room, updatedPlayers));
  await port.announceFilled(claim.room, updatedPlayers.length);
}

// A spectator is a viewer with no seat, so sanitizeStateForPlayer already
// blanks every hand for them and every game handler resolves the actor by
// seat and returns. There is no spectator-specific path to get wrong.
export async function spectateRoomIntent(
  port: LobbyPort,
  { code }: z.infer<typeof RoomJoinSchema>
): Promise<EventOutcome | void> {
  const room = await port.store.getRoomByCode(code.toUpperCase());
  if (!room) {
    port.refuse(payload("ROOM_NOT_FOUND"));
    return { ok: false, code: "ROOM_NOT_FOUND" };
  }

  const admitted = await port.table({ kind: "spectate", roomId: room.id, userId: port.userId });
  if (!admitted.ok) {
    port.refuse(
      admitted.code === "ALREADY_IN_ROOM" ? payload("ALREADY_IN_ROOM") : payload("GAME_NOT_FOUND")
    );
    return admitted;
  }

  const previous = port.watching.get(port.socketId);
  if (previous && previous !== room.id) {
    await port.table({ kind: "unspectate", roomId: previous, userId: port.userId });
    port.leave(previous);
  }
  port.watching.set(port.socketId, room.id);
  port.join(room.id);
}
