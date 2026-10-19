// server/socket/lobbyIntents.ts — the decisions behind every lobby intent a
// socket makes before a match starts, with every effect passed in as a port so
// `node --test` can drive them with no socket and no Postgres. Not a
// TableAction: those route to the instance holding a live game, and a lobby has
// no game to hold.
import type { roomStore, SeatClaim } from "../store/roomStore.ts";
import type { roomStatePayload, announceIfFilled } from "./socketTable.ts";
import type { TableActionDraft } from "../game/tableActions.ts";
import type { trackEvent } from "./events.ts";
import type { WireRoomState } from "../../shared/protocol.ts";
import type { z } from "zod";
import type {
  RoomCreateSchema,
  RoomJoinSchema,
  RoomQuickmatchSchema,
  RoomSetVisibilitySchema,
} from "../../shared/socketSchemas.ts";
import type { ServerCode } from "../shared/payload.ts";
import { teamsSizeRefusal } from "./socketTable.ts";
import { logger } from "../http/logger.ts";
import { OK, refuse, type Outcome } from "../shared/refusal.ts";

export interface LobbyPort {
  userId: string;
  socketId: string;
  store: Pick<
    typeof roomStore,
    | "createRoom"
    | "addRoomPlayer"
    | "getRoomPlayers"
    | "getRoomByCode"
    | "getRoomById"
    | "claimRoomSeat"
    | "updateRoomVisibility"
    | "findWaitingPublicRooms"
  >;
  watching: Map<string, string>;
  /** `server/socket/seating.ts` `seatSocket`, the only way a socket takes a seat. */
  seat(roomId: string): Promise<void>;
  sendState(state: WireRoomState): void;
  broadcastState(roomId: string, state: WireRoomState): void;
  join(roomId: string): void;
  leave(roomId: string): void;
  roomState: typeof roomStatePayload;
  table(draft: TableActionDraft): Promise<Outcome>;
  announceFilled(room: Parameters<typeof announceIfFilled>[1], seated: number): Promise<void>;
  announceChanged(roomId: string): Promise<void>;
  clearLobbyGrace(roomId: string, userId: string): void;
  track: typeof trackEvent;
}

type SeatClaimReason = Extract<SeatClaim, { ok: false }>["reason"];

/** Why a seat claim was refused, as the code the client localises. */
export const SEAT_CLAIM_REFUSAL = {
  no_room: "ROOM_NOT_FOUND",
  not_waiting: "GAME_ALREADY_STARTED",
  full: "ROOM_FULL",
  held: "SEAT_HELD",
  already_joined: "ALREADY_IN_ROOM",
  not_public: "ROOM_NOT_FOUND",
  empty: "ROOM_NOT_FOUND",
} as const satisfies Record<SeatClaimReason, ServerCode>;

type ClaimedRoom = Extract<SeatClaim, { ok: true }>["room"];

/** The tail every claimed seat runs, whichever intent claimed it. */
async function takeClaimedSeat(port: LobbyPort, room: ClaimedRoom): Promise<number> {
  await port.seat(room.id);
  const players = await port.store.getRoomPlayers(room.id);
  port.broadcastState(room.id, await port.roomState(room, players));
  await port.announceFilled(room, players.length);
  return players.length;
}

export async function createRoomIntent(
  port: LobbyPort,
  { gameMode, maxPlayers }: z.infer<typeof RoomCreateSchema>,
  opts: { visibility: "public"; autoStart: true } | undefined = undefined
): Promise<Outcome> {
  const teams = teamsSizeRefusal(gameMode, maxPlayers);
  if (teams) return teams;
  const room = await port.store.createRoom(
    port.userId,
    gameMode,
    maxPlayers,
    opts?.visibility ?? "private",
    opts?.autoStart ?? false
  );
  await port.store.addRoomPlayer(room.id, port.userId, 0);

  await port.seat(room.id);

  const players = await port.store.getRoomPlayers(room.id);
  port.sendState(await port.roomState(room, players));
  logger.info({ roomId: room.id, userId: port.userId }, "Room created");
  return OK;
}

export async function joinRoomIntent(port: LobbyPort, { code }: z.infer<typeof RoomJoinSchema>): Promise<Outcome> {
  const room = await port.store.getRoomByCode(code.toUpperCase());
  if (!room) return refuse("ROOM_NOT_FOUND");
  if (room.status !== "waiting") return refuse("GAME_ALREADY_STARTED");

  const claim = await port.store.claimRoomSeat(room.id, port.userId);
  if (!claim.ok) return refuse(SEAT_CLAIM_REFUSAL[claim.reason]);

  const seated = await takeClaimedSeat(port, claim.room);
  port.track("room.joined", port.userId, { playerCount: seated, gameMode: claim.room.gameMode });
  return OK;
}

// A spectator is a viewer with no seat, so sanitizeStateForPlayer already
// blanks every hand for them and every game handler resolves the actor by
// seat and returns. There is no spectator-specific path to get wrong.
export async function spectateRoomIntent(
  port: LobbyPort,
  { code }: z.infer<typeof RoomJoinSchema>
): Promise<Outcome> {
  const room = await port.store.getRoomByCode(code.toUpperCase());
  if (!room) return refuse("ROOM_NOT_FOUND");

  const admitted = await port.table({ kind: "spectate", roomId: room.id, userId: port.userId });
  if (!admitted.ok) {
    return admitted.code === "ALREADY_IN_ROOM" ? refuse("ALREADY_IN_ROOM") : refuse("GAME_NOT_FOUND");
  }

  const previous = port.watching.get(port.socketId);
  if (previous && previous !== room.id) {
    await port.table({ kind: "unspectate", roomId: previous, userId: port.userId });
    port.leave(previous);
  }
  port.watching.set(port.socketId, room.id);
  port.join(room.id);
  return OK;
}

/**
 * Coming back to a waiting lobby on a new socket. The seat row is the whole
 * proof of membership: it outlives a disconnect for LOBBY_GRACE_MS, so a
 * caller still holding one dropped and returned, and anyone else holding the
 * code is arriving, which is `room:join`.
 */
export async function rejoinRoomIntent(port: LobbyPort, { code }: z.infer<typeof RoomJoinSchema>): Promise<Outcome> {
  const room = await port.store.getRoomByCode(code.toUpperCase());
  if (!room) return refuse("ROOM_NOT_FOUND");

  const seated = await port.store.getRoomPlayers(room.id);
  if (!seated.some((p) => p.userId === port.userId)) return refuse("NOT_IN_ROOM");

  const claim = await port.store.claimRoomSeat(room.id, port.userId);
  if (!claim.ok && claim.reason !== "already_joined") return refuse(SEAT_CLAIM_REFUSAL[claim.reason]);

  await port.seat(room.id);
  port.clearLobbyGrace(room.id, port.userId);

  const players = await port.store.getRoomPlayers(room.id);
  port.broadcastState(room.id, await port.roomState(claim.room, players));
  return OK;
}

// Making a room visible to strangers is the host's act and nobody else's, so
// the seat that asked is checked against the row rather than against whatever
// the client believes about who is hosting.
export async function setVisibilityIntent(
  port: LobbyPort,
  roomId: string | null,
  { visibility }: z.infer<typeof RoomSetVisibilitySchema>
): Promise<Outcome> {
  if (!roomId) return { ok: false, code: "NOT_AT_A_TABLE" };

  const room = await port.store.getRoomById(roomId);
  if (!room) return refuse("ROOM_NOT_FOUND");
  if (room.hostUserId !== port.userId) return refuse("NOT_HOST");
  if (room.status !== "waiting") return refuse("GAME_ALREADY_STARTED");

  await port.store.updateRoomVisibility(roomId, visibility);
  await port.announceChanged(roomId);
  return OK;
}

export async function quickmatchIntent(
  port: LobbyPort,
  { maxPlayers, gameMode }: z.infer<typeof RoomQuickmatchSchema>
): Promise<Outcome> {
  const teams = teamsSizeRefusal(gameMode, maxPlayers);
  if (teams) return teams;

  for (const candidate of await port.store.findWaitingPublicRooms(port.userId)) {
    if (candidate.containsUser) continue;
    // Nobody in it means nobody is coming: the row outlived the write that
    // should have closed it, and seating someone alone in it would strand
    // them in a lobby with a host who already left.
    if (candidate.playerCount === 0) continue;
    if (
      candidate.room.maxPlayers !== maxPlayers ||
      candidate.room.gameMode !== gameMode ||
      candidate.playerCount >= candidate.room.maxPlayers
    )
      continue;

    const claim = await port.store.claimRoomSeat(candidate.room.id, port.userId, {
      requirePublic: true,
      requireOccupied: true,
    });
    if (!claim.ok) continue;

    await takeClaimedSeat(port, claim.room);
    return OK;
  }

  return createRoomIntent(port, { gameMode, maxPlayers }, { visibility: "public", autoStart: true });
}
