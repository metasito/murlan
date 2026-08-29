// server/socketTable.ts — the room roster and the seat, as every family sees
// them.
//
// These are shared by the room handlers, the gameplay handlers and the
// disconnect path alike, so they live apart from all three: leaving them in
// socket.ts while socket.ts imports the room family would be a cycle.
import type { Server as SocketServer, Socket } from "socket.io";
import { storage } from "./storage.ts";
import { logger } from "./logger.ts";
import {
  activeGames,
  socketRoomMap,
  userSocketMap,
} from "./gameRoom.ts";
import type { OnlineGameState } from "./gameRoom.ts";
import {
  LOBBY_GRACE_MS,
  lobbyGraceTimers,
  lobbyGraceKey,
  clearLobbyGrace,
  clearAllTimersForUser,
} from "./gameTimers.ts";
import { sendGameStateTo } from "./gamePersistence.ts";
import { scoresByName } from "./gameOver.ts";
import { armTurnIfIdle, vacateSeat } from "./gameTurn.ts";

let shuttingDown = false;

/**
 * Called before `io.close()`. Every socket is about to be disconnected, and a
 * lobby seat held for a grace period the next process will never honour is a
 * room nobody can join and nothing will clean up.
 */
export function beginShutdown() {
  shuttingDown = true;
}

export function roomStatePayload(
  room: {
    id: string;
    code: string;
    hostUserId: string | null;
    status: string;
    gameMode: string;
    maxPlayers: number;
    visibility: string;
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
    visibility: room.visibility,
    players: players.map((p) => ({
      seatIndex: p.seatIndex,
      userId: p.userId,
      username: p.user.username,
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
  };
}

/**
 * Re-sends `room:state` to a single rejoining socket. The client's only route
 * back into the game screen is `room` -> `/(online)/room` -> `gameState` ->
 * `/(online)/game`, so replying with `game:state` alone strands the player on
 * the lobby holding a live hand. A failed roster read must cost the roster and
 * not the reply.
 */
export async function emitRoomStateTo(socket: Socket, roomId: string, game: OnlineGameState) {
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
export async function rejoinSocketToTable(
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
  sendGameStateTo(io, userId, game);
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

/**
 * Holds a lobby seat open for LOBBY_GRACE_MS, then releases it.
 *
 * Nothing is broadcast when the timer is armed. A blip the player recovers
 * from should be invisible to the rest of the room, and the seat row staying
 * put is what makes `room:rejoin` work without a memory of who dropped.
 */
export function armLobbyGrace(
  io: SocketServer,
  roomId: string,
  userId: string,
  username: string
): Promise<void> | void {
  // A shutdown is not a blip. Holding the seat would leave a `waiting` lobby
  // full of players who are already gone, and the next process has no memory
  // of the timer that was going to clear it.
  if (shuttingDown) {
    return handleSeatRelease(io, roomId, userId, username, { source: "disconnect" });
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
        await handleSeatRelease(io, roomId, userId, username, { source: "disconnect" });
        logger.info({ userId, roomId }, "Lobby grace expired — seat released");
      } catch (err) {
        logger.error({ err, userId, roomId }, "Lobby grace handler failed");
      }
    })();
  }, LOBBY_GRACE_MS);
  // A seat waiting to be given back must not be what keeps the process alive:
  // shutdown disconnects every socket, which arms one of these per lobby, and
  // the row outlives the process either way.
  (timer as unknown as { unref?: () => void }).unref?.();
  lobbyGraceTimers.set(lobbyGraceKey(roomId, userId), timer);
}

/**
 * Releases a seat: the room_players row, the user's timers, and the seat in a
 * live game. A `room:leave` and a lost connection differ only in what the
 * caller can hand over, so the seat-side work lives in one place.
 *
 * Runs on the disconnect path inside a `void (async () => …)`, so every storage
 * call is `.catch`-guarded: an unguarded throw there strands the room.
 */
export async function handleSeatRelease(
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
      return;
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
