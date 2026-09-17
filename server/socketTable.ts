// server/socketTable.ts — the room roster and the seat, as every family sees
// them.
//
// These are shared by the room handlers, the gameplay handlers and the
// disconnect path alike, so they live apart from all three: leaving them in
// socket.ts while socket.ts imports the room family would be a cycle.
import type { SocketServer, GameSocket as Socket } from "./socketTypes.ts";
import { friendStore } from "./friendStore.ts";
import { roomStore } from "./roomStore.ts";
import { logger } from "./logger.ts";
import {
  isShuttingDown,
  seatName,
  seatOfUser,
  socketRoomMap,
  userRoom,
  userSocketMap,
} from "./gameRoom.ts";
import type { OnlineGameState } from "./gameRoom.ts";
import { applyOrForward } from "./tableRouter.ts";
import {
  lobbyGraceMs,
  lobbyGraceTimers,
  lobbyGraceKey,
  clearLobbyGrace,
  clearAllTimersForUser,
  disconnectDeadlines,
  disconnectTimers,
  autoStartDelayMs,
  autoStartTimers,
  clearAutoStart,
} from "./gameTimers.ts";
import { broadcastRematchIntents } from "./gameOver.ts";
import { sendGameStateTo } from "./gamePersistence.ts";
import { emitEndMatchVoteState, emitMatchState, emitVoteState } from "./emit.ts";
import { armTurnIfIdle } from "./gameTurn.ts";
import { payload } from "./payload.ts";
import { TEAMS_PLAYER_COUNT } from "../lib/gameEngine.ts";
import type { EventOutcome } from "./socketSafety.ts";
import type { WireRoomState } from "../shared/protocol.ts";

/**
 * Async because the seat holds are part of the room, not an extra message:
 * every broadcast carries them, so no path can seat a player into a lobby that
 * has forgotten which seats are spoken for. A failed read costs the holds and
 * not the roster.
 */
export async function roomStatePayload(
  room: {
    id: string;
    code: string;
    hostUserId: string | null;
    status: WireRoomState["status"];
    gameMode: WireRoomState["gameMode"];
    maxPlayers: number;
    visibility: WireRoomState["visibility"];
  },
  players: { seatIndex: number; userId: string; user: { username: string } }[]
): Promise<WireRoomState> {
  const holds =
    room.status === "waiting"
      ? await roomStore.getRoomSeatHolds(room, players).catch((err: unknown) => {
          logger.warn({ err, roomId: room.id }, "seat holds read failed; the lobby shows none");
          return [];
        })
      : [];
  const now = Date.now();
  return {
    roomId: room.id,
    code: room.code,
    hostUserId: room.hostUserId,
    status: room.status,
    gameMode: room.gameMode,
    maxPlayers: room.maxPlayers,
    visibility: room.visibility,
    players: players.map((p) => ({
      seatIndex: p.seatIndex,
      userId: p.userId,
      username: p.user.username,
    })),
    // Remaining, never a wall-clock deadline: the client's clock is not the
    // server's, and the difference is the whole length of a short hold.
    seatHolds: holds.map((hold) => ({
      seatIndex: hold.seatIndex,
      username: hold.username,
      expiresInMs: Math.max(0, hold.expiresAt - now),
    })),
  };
}

/** The seats of a running table in the shape `room_players` reads back. */
export function seatedHumansOf(game: OnlineGameState) {
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
export function roomOf(game: OnlineGameState) {
  return {
    id: game.roomId,
    code: game.joinCode,
    hostUserId: game.playerMap[0] ?? null,
    status: "in_progress",
    gameMode: game.gameMode,
    maxPlayers: game.maxPlayers,
    // Reached only when the rooms row could not be read, and a running game
    // takes nobody either way. Private is the answer that cannot mislead.
    visibility: "private",
  } as const;
}

/**
 * Teams is the one mode with a fixed size, checked both where a room is sized
 * and where it is seated. Returns the refusal when the size is wrong, null when
 * the caller may carry on — one spelling of the code, whether it goes out as an
 * acknowledgement or as a `room:error`.
 *
 * Takes a sink rather than a socket: one caller is a lobby handler holding the
 * player's own socket, the other runs on the instance that owns the table and
 * has only the player's user room. The sink names the event, so it stays a
 * literal at each call site.
 */
export function teamsSizeRefusal(
  refuse: (refusal: { message: string; code: string }) => void,
  gameMode: string,
  playerCount: number
): EventOutcome | null {
  if (gameMode !== "teams" || playerCount === TEAMS_PLAYER_COUNT) return null;
  const code = "TEAMS_REQUIRE_FOUR";
  refuse(payload(code));
  return { ok: false, code };
}

/**
 * Re-sends `room:state` to one rejoining player. The client's only route back
 * into the game screen is `room` -> `/(online)/room` -> `gameState` ->
 * `/(online)/game`, so replying with `game:state` alone strands the player on
 * the lobby holding a live hand. A failed roster read must cost the roster and
 * not the reply.
 */
export async function emitRoomStateTo(
  io: SocketServer,
  userId: string,
  roomId: string,
  game: OnlineGameState
) {
  const [room, players] = await Promise.all([
    roomStore.getRoomById(roomId).catch((err: unknown) => {
      logger.warn({ err, roomId }, "getRoomById failed; answering from the live game");
      return undefined;
    }),
    roomStore.getRoomPlayers(roomId).catch((err: unknown) => {
      logger.warn({ err, roomId }, "getRoomPlayers failed; answering from the live roster");
      return [];
    }),
  ]);
  // A running game always seats at least one human, so an empty roster is the
  // rows being gone rather than the table being empty.
  const payload = await roomStatePayload(
    room ?? roomOf(game),
    players.length > 0 ? players : seatedHumansOf(game)
  );
  io.to(userRoom(userId)).emit("room:state", payload);
}

/** The half of a rejoin that belongs to the socket rather than to the table. */
export function joinSocketToRoom(socket: Socket, roomId: string) {
  socket.join(roomId);
  socketRoomMap.set(socket.id, roomId);
}

/**
 * Tells a player, and their table, that they are back.
 *
 * The one emitter of `game:player_reconnected`, so its payload cannot differ
 * between the two paths that reach it. Everything here is addressed to the
 * account rather than to a socket: this runs on the instance that owns the
 * game, which is not necessarily the one holding the player's connection. The
 * caller owns the seat check and the `room_players` row — the grace-timer path
 * still holds one, the rejoin path may not.
 */
export async function announceRejoin(
  io: SocketServer,
  userId: string,
  roomId: string,
  game: OnlineGameState
) {
  const seatIndex = seatOfUser(game, userId);
  const username = seatName(game, seatIndex);
  // Caught, not propagated: the handler's blanket catch would turn a failed
  // roster refresh into a SERVER_ERROR that forfeits a live game.
  await emitRoomStateTo(io, userId, roomId, game).catch((err: unknown) =>
    logger.warn({ err, roomId, userId }, "emitRoomStateTo failed")
  );
  sendGameStateTo(io, userId, game);
  // The client reads this as the framing of a manche that has just begun and
  // zeroes the match verdict and the rematch tally along with it, so it is
  // only right while one is running — at the results screen `game:over` and
  // `game:rematch_intents` own those.
  if (!game.gameState.gameOver) {
    emitMatchState(io, userRoom(userId), game);
  } else if (game.lastGameOverPayload) {
    // A rejoin at the results screen: everyone still in the room got
    // `game:over` when the hand ended, but this socket was not one of them.
    // Re-sent to this account only, so a client that never left is not told
    // its own hand twice.
    io.to(userRoom(userId)).emit("game:over", game.lastGameOverPayload);
    emitVoteState(io, userRoom(userId), game);
    broadcastRematchIntents(io, game, userRoom(userId));
  }
  emitEndMatchVoteState(io, userRoom(userId), game);
  for (const other of Object.values(game.playerMap)) {
    const deadline = disconnectDeadlines.get(other);
    if (other === userId || deadline === undefined || !disconnectTimers.has(other)) continue;
    const otherSeat = seatOfUser(game, other);
    const otherName = seatName(game, otherSeat);
    const seconds = Math.max(1, Math.ceil((deadline - Date.now()) / 1000));
    io.to(userRoom(userId)).emit("game:player_disconnected", {
      userId: other,
      username: otherName,
      seatIndex: otherSeat,
      ...payload("PLAYER_DISCONNECTED_GRACE", { username: otherName, seconds }),
    });
  }
  io.to(roomId).emit("game:player_reconnected", {
    userId,
    username,
    seatIndex,
    ...payload("PLAYER_RECONNECTED", { username }),
  });
  armTurnIfIdle(io, roomId);
}

/**
 * Holds a lobby seat open for the lobby grace, then releases it.
 *
 * Nothing is broadcast when the timer is armed. A blip the player recovers
 * from should be invisible to the rest of the room, and the seat row staying
 * put is what makes `room:rejoin` work without a memory of who dropped.
 */
export function armLobbyGrace(
  io: SocketServer,
  roomId: string,
  userId: string
): Promise<void> | void {
  // A shutdown is not a blip. Holding the seat would leave a `waiting` lobby
  // full of players who are already gone, and the next process has no memory
  // of the timer that was going to clear it.
  if (isShuttingDown()) {
    return handleSeatRelease(io, roomId, userId, { source: "disconnect" });
  }
  clearLobbyGrace(roomId, userId);
  const timer = setTimeout(() => {
    void (async () => {
      try {
        lobbyGraceTimers.delete(lobbyGraceKey(roomId, userId));
        // Back in *this* room, not merely back online: a player who reconnects
        // straight into a different lobby is no longer holding this seat, and
        // asking only whether they have a socket would leave it held.
        const liveSocket = userSocketMap.get(userId);
        if (liveSocket && socketRoomMap.get(liveSocket) === roomId) return;
        await handleSeatRelease(io, roomId, userId, { source: "disconnect" });
        logger.info({ userId, roomId }, "Lobby grace expired — seat released");
      } catch (err) {
        logger.error({ err, userId, roomId }, "Lobby grace handler failed");
      }
    })();
  }, lobbyGraceMs());
  // A seat waiting to be given back must not be what keeps the process alive:
  // shutdown disconnects every socket, which arms one of these per lobby, and
  // the row outlives the process either way.
  (timer as unknown as { unref?: () => void }).unref?.();
  lobbyGraceTimers.set(lobbyGraceKey(roomId, userId), timer);
}

/**
 * An invitee is not in the room, so `io.to(roomId)` never reaches them; the
 * account's own room is the only channel that does. The room's code rides along
 * because a client may be holding a second invite it must not act on.
 */
function tellInvitees(
  io: SocketServer,
  inviteeIds: string[],
  event: string,
  payload: Record<string, unknown>
): void {
  for (const inviteeId of inviteeIds) {
    io.to(userRoom(inviteeId)).emit(event, payload);
  }
}

/**
 * Re-reads a waiting room and tells everyone seated in it what it now is.
 * Every path that changes a seat hold or the room's own visibility routes
 * through here — a lobby's "held for", and whether strangers can see the
 * room, must change on the same event that changed it, not on whatever
 * broadcast happens to come along next.
 */
export async function announceRoomChanged(io: SocketServer, roomId: string): Promise<void> {
  const [room, players] = await Promise.all([
    roomStore.getRoomById(roomId).catch((err: unknown) => {
      logger.warn({ err, roomId }, "Failed to read the room while announcing a room change");
      return null;
    }),
    roomStore.getRoomPlayers(roomId).catch((err: unknown) => {
      logger.warn({ err, roomId }, "Failed to read the roster while announcing a room change");
      return null;
    }),
  ]);
  if (!room || !players) return;
  io.to(roomId).emit("room:state", await roomStatePayload(room, players));
}

/** Retires every invite pointing at a room that can no longer be joined. */
export async function retireRoomInvites(
  io: SocketServer,
  roomId: string,
  roomCode: string
): Promise<void> {
  const invitees = await friendStore.clearGameInvites(roomId).catch((err) => {
    logger.warn({ err, roomId }, "Failed to clear the invites of a room that closed");
    return [] as string[];
  });
  tellInvitees(io, invitees, "friend:invite_retired", { roomCode });
  if (invitees.length > 0) await announceRoomChanged(io, roomId);
}

/**
 * The room's last seat went, or came back. The rows are left alone: a full room
 * is not a finished one, and an invite deleted when a stranger sat down could
 * not return when they left.
 */
export async function announceRoomJoinable(
  io: SocketServer,
  roomId: string,
  roomCode: string,
  joinable: boolean
): Promise<void> {
  const invitees = await friendStore.getRoomInvitees(roomId).catch((err: unknown) => {
    logger.warn({ err, roomId, joinable }, "Failed to read who holds an invite to a room");
    return [] as string[];
  });
  tellInvitees(io, invitees, "friend:room_joinable", { roomCode, joinable });
}

/**
 * Announces a room that has just taken its last seat. Every path that seats a
 * player calls this, so a lobby filled by quickmatch is as closed as one filled
 * by code — the same public lobby a host can still invite friends into.
 */
export async function announceIfFilled(
  io: SocketServer,
  room: {
    id: string;
    code: string;
    maxPlayers: number;
    hostUserId: string | null;
    autoStart: boolean;
  },
  seated: number
): Promise<void> {
  if (seated < room.maxPlayers) return;
  await announceRoomJoinable(io, room.id, room.code, false);
  scheduleAutoStart(io, room);
}

/**
 * Deals a matchmade table on its own once it is full.
 *
 * Strangers matched together have nobody among them who agreed to host, so
 * waiting on the seat quickmatch happened to create first is waiting on
 * someone who never asked for the job (#1088). A room from `room:create` is
 * `autoStart: false` and still waits for its host.
 *
 * The room is read again when the timer fires rather than trusted from the
 * moment it was armed: a seat can empty in between, and dealing then would
 * start a match the table no longer has.
 */
function scheduleAutoStart(
  io: SocketServer,
  room: { id: string; hostUserId: string | null; autoStart: boolean }
): void {
  if (!room.autoStart || autoStartTimers.has(room.id)) return;

  const timer = setTimeout(() => {
    autoStartTimers.delete(room.id);
    void (async () => {
      try {
        const current = await roomStore.getRoomById(room.id);
        if (!current || current.status !== "waiting" || !current.hostUserId) return;
        const players = await roomStore.getRoomPlayers(room.id);
        if (players.length < current.maxPlayers) return;
        await applyOrForward(io, {
          kind: "startMatch",
          roomId: room.id,
          userId: current.hostUserId,
          fillWithBots: false,
        });
      } catch (err) {
        logger.warn({ err, roomId: room.id }, "Matchmade table failed to deal itself");
      }
    })();
  }, autoStartDelayMs());
  autoStartTimers.set(room.id, timer);
}

/**
 * Releases a seat: the room_players row, the user's timers, and the seat in a
 * live game. A `room:leave` and a lost connection differ only in what the
 * caller can hand over, so the seat-side work lives in one place.
 *
 * Runs on the disconnect path inside a `void (async () => …)`, so every store
 * call is `.catch`-guarded: an unguarded throw there strands the room.
 */
export async function handleSeatRelease(
  io: SocketServer,
  roomId: string,
  userId: string,
  opts: {
    socket?: { id: string; leave: (r: string) => void };
    source: "leave" | "disconnect";
  }
) {
  clearAllTimersForUser(userId, roomId);
  clearAutoStart(roomId);

  const released = await roomStore.releaseSeat(roomId, userId).catch((err) => {
    logger.warn(
      { err, roomId, userId, source: opts.source },
      "Failed to release the room_players row — the seat stays counted as taken"
    );
    return null;
  });
  opts.socket?.leave(roomId);

  // A failed release says nothing about whether a game holds the seat, and a
  // held seat must still go to a bot; a room with no game answers the vacate
  // with a refusal and nothing else.
  if (!released) {
    await applyOrForward(io, { kind: "vacate", roomId, userId });
    return;
  }
  const { room, remaining, emptied } = released;

  if (emptied) {
    await retireRoomInvites(io, roomId, room.code);
  } else if (room.status === "waiting") {
    io.to(roomId).emit("room:state", await roomStatePayload(room, remaining));
    // Only the edge, matching the filling side: a 4-seat lobby going 2 → 1 was
    // joinable before and after, and its invitees have nothing to re-ask.
    if (remaining.length === room.maxPlayers - 1) {
      await announceRoomJoinable(io, roomId, room.code, true);
    }
  } else {
    // Routed rather than read out of this process's own map: the seat is live
    // in whichever instance holds the game, and reading `activeGames` here
    // found nothing whenever the player's socket had landed anywhere else.
    await applyOrForward(io, { kind: "vacate", roomId, userId });
  }
}
