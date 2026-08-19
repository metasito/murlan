import type { Server as SocketServer } from "socket.io";
import { eq, inArray, lt } from "drizzle-orm";
import { storage } from "./storage.ts";
import { logger } from "./logger.ts";
import { db } from "./db.ts";
import { recordGameResult } from "./stats.ts";
import { recordRatedResult } from "./ratings.ts";
import { saveReplay } from "./replays.ts";
import {
  activeGames as activeGamesTable,
  roomPlayers as roomPlayersTable,
  rooms as roomsTable,
} from "../shared/schema.ts";
import {
  activeGames,
  lobbyDropouts,
  publicRoomIds,
  userSocketMap,
} from "./gameRoom.ts";
import type { OnlineGameState } from "./gameRoom.ts";
import type { GameOverWriters } from "./gameOver.ts";
import {
  SWEEP_INTERVAL_MS,
  clearRoomTimers,
  clearRoomDisconnectTimers,
  secondsUntil,
} from "./gameTimers.ts";
import {
  findViewerSeat,
  visibleExchangePhase,
  packPersistedState,
} from "./onlineGameLogic.ts";
import type { GameState, Card } from "../lib/gameEngine.ts";

/**
 * How long an `active_games` row may sit untouched before it is abandoned.
 *
 * The in-memory sweep cannot see these. A restart empties `activeGames`, and
 * every path that deletes a row — a table finishing, the last human leaving,
 * the disconnect grace expiring — walks that Map. A game that was live when the
 * process went down, and that nobody ever rejoins, is invisible to all of them
 * and its row stays forever. On a host that sleeps, which is where this app
 * runs, that happens on every sleep with a game open.
 *
 * A day is far past any live game: `persistGameState` refreshes `updated_at` on
 * every single move, and a table nobody is playing is disposed within the
 * disconnect grace. The margin is there so a row a player might still
 * legitimately rejoin is never taken out from under them.
 */
export const ABANDONED_GAME_MAX_AGE_MS = 24 * 60 * 60_000;

/**
 * How long a `rooms` row may live before the sweeper takes it.
 *
 * Derived from `created_at` rather than a "finished at" column, because a
 * timestamp on `rooms` would be a new column on a table written every time
 * anyone opens a table — the write that breaks until `db:push` runs. No game
 * lasts a day, so age alone separates a live room from a dead one, and it
 * covers the rooms a restart stranded in `waiting` as well as the finished
 * ones.
 */
export const STALE_ROOM_MAX_AGE_MS = 24 * 60 * 60_000;

/** Rooms deleted per sweep. Bounds the size of one statement, not the total. */
const STALE_ROOM_BATCH = 500;

export function sanitizeStateForPlayer(
  state: GameState,
  viewerUserId: string,
  playerMap: Record<number, string>,
  turnDeadlineMs?: number
) {
  // The server knows which seat the viewer occupies authoritatively; ship it
  // with every state so the client never has to derive it (e.g. from a lobby
  // `room` object that is null across a cold-start rejoin).
  const viewerSeatIndex = findViewerSeat(playerMap, viewerUserId);
  return {
    ...state,
    viewerSeatIndex,
    // Seconds rather than the deadline itself: a device whose clock is off by
    // minutes would render an absolute timestamp as a clock that is already
    // over or never moves. The deadline rides along only as a reset key.
    turnDeadlineMs,
    turnSecondsRemaining: secondsUntil(turnDeadlineMs),
    // Strips `cardFromLoser` — a named card out of a named player's hand —
    // down to only the two seats in the exchange, and only while it is active.
    exchangePhase: visibleExchangePhase(
      state.exchangePhase,
      viewerSeatIndex
    ) as GameState["exchangePhase"],
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

/** Drops every in-memory trace of a room. */
export function disposeGame(roomId: string, deleteRow = true) {
  const game = activeGames.get(roomId);
  if (game) clearRoomDisconnectTimers(game);
  clearRoomTimers(roomId);
  activeGames.delete(roomId);
  publicRoomIds.delete(roomId);
  if (deleteRow) {
    db.delete(activeGamesTable)
      .where(eq(activeGamesTable.roomId, roomId))
      .catch((err: unknown) =>
        logger.error({ err, roomId }, "Failed to delete persisted game")
      );
  }
}

/**
 * Writes the room's live state. Failures are logged, never thrown — a
 * persistence problem must not break a table. The promise is returned so a
 * caller that is about to delete the same row can order itself after it.
 */
export function persistGameState(roomId: string, game: OnlineGameState): Promise<unknown> {
  // Stamped so a restart can tell a current-shape row from a stale one (see
  // GAME_SCHEMA_VERSION) rather than restoring a corrupt hand silently.
  const values = {
    roomId,
    gameState: packPersistedState(game.gameState, game.handFlags, game.dealFirstSeat, {
      playerMap: game.playerMap,
      scores: game.cumulativeScores,
      gameMode: game.gameMode,
      matchLength: game.matchLength,
      matchTarget: game.matchTarget,
      maxPlayers: game.maxPlayers,
      isPublic: publicRoomIds.has(roomId),
    }),
    updatedAt: new Date(),
  };
  return db
    .insert(activeGamesTable)
    .values(values)
    .onConflictDoUpdate({
      target: activeGamesTable.roomId,
      set: { gameState: values.gameState, updatedAt: values.updatedAt },
    })
    .catch((err: unknown) =>
      logger.error({ err, roomId }, "Failed to persist game state")
    );
}

export function broadcastGameState(io: SocketServer, game: OnlineGameState) {
  const { gameState, playerMap } = game;
  const send = (uid: string) => {
    const target = userSocketMap.get(uid);
    if (!target) return;
    io.to(target).emit("game:state", sanitizeStateForPlayer(gameState, uid, playerMap, game.turnDeadlineMs));
  };
  Object.values(playerMap).forEach(send);
  // Spectators go through the same sanitiser. findViewerSeat returns null for
  // a userId that holds no seat, and every hand is blanked on that basis, so a
  // spectator cannot be sent a card without the seated path breaking first.
  game.spectators.forEach(send);
}

/**
 * Runs a timer body under the same contract `onEvent` gives an inbound event: a
 * throw degrades to a closed table rather than escaping the callback.
 *
 * The containment is load-bearing rather than tidy. `armTurn` clears the room's
 * timers before it arms the next one, and it is only ever reached from a move, a
 * rejoin, a disconnect or another timer — so a throw inside a timer body leaves
 * the room with nothing pending and nothing that will ever re-arm it. The table
 * stops on a turn that cannot be taken, and the client's clock has no `onExpire`
 * to notice. Closing the table loudly is the recoverable outcome.
 */
export function safeTimer(
  io: SocketServer | null,
  label: string,
  roomId: string,
  fn: () => void
): void {
  try {
    fn();
  } catch (err) {
    logger.error({ err, roomId, label }, "Timer callback threw — closing table");
    io?.to(roomId).emit("game:notification", {
      type: "abandoned",
      code: "GAME_INTERRUPTED_SERVER_ERROR",
      message: "Partita interrotta: errore del server.",
    });
    void storage
      .updateRoomStatus(roomId, "finished")
      .catch((statusErr) =>
        logger.warn(
          { err: statusErr, roomId, label },
          "Failed to set rooms.status = finished after a timer callback threw"
        )
      );
    disposeGame(roomId);
  }
}

/**
 * Deletes `active_games` rows untouched for longer than
 * `ABANDONED_GAME_MAX_AGE_MS`. Returns how many went, so a caller can tell
 * "nothing to do" from "did not run".
 */
export async function pruneAbandonedGames(): Promise<number> {
  const cutoff = new Date(Date.now() - ABANDONED_GAME_MAX_AGE_MS);
  const gone = await db
    .delete(activeGamesTable)
    .where(lt(activeGamesTable.updatedAt, cutoff))
    .returning({ roomId: activeGamesTable.roomId });
  if (gone.length > 0) {
    logger.info({ count: gone.length }, "Pruned abandoned games orphaned by a restart");
  }
  return gone.length;
}

/**
 * Deletes rooms nobody can still be playing in, and the seats that name them.
 *
 * `disposeGame` clears the `active_games` row when a table ends;
 * `updateRoomStatus(…, "finished")` is all that ever happened to the `rooms`
 * row, so every online game ever played left one behind, plus a
 * `room_players` row per seat. `room_players` has no cascade, so its rows go
 * first — the same order `storage.deleteUser` uses.
 *
 * A room still in the in-memory map is never a candidate, whatever its age.
 */
export async function pruneStaleRooms(): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_ROOM_MAX_AGE_MS);
  const candidates = await db
    .select({ id: roomsTable.id })
    .from(roomsTable)
    .where(lt(roomsTable.createdAt, cutoff))
    .limit(STALE_ROOM_BATCH);

  const ids = candidates.map((r) => r.id).filter((id) => !activeGames.has(id));
  if (ids.length === 0) return 0;
  // A lobby nobody ever came back to keeps its dropout records until here.
  ids.forEach((id) => lobbyDropouts.delete(id));

  await db.delete(roomPlayersTable).where(inArray(roomPlayersTable.roomId, ids));
  await db.delete(activeGamesTable).where(inArray(activeGamesTable.roomId, ids));
  const gone = await db
    .delete(roomsTable)
    .where(inArray(roomsTable.id, ids))
    .returning({ id: roomsTable.id });

  if (gone.length > 0) {
    logger.info({ count: gone.length }, "Pruned rooms nobody can still be playing in");
  }
  return gone.length;
}

let sweeper: ReturnType<typeof setInterval> | null = null;

/**
 * Long-running server hygiene: drop finished tables nobody is connected to and
 * forget public rooms that are no longer joinable.
 */
export function startSweeper(io: SocketServer) {
  if (sweeper) return;
  sweeper = setInterval(() => {
    try {
      for (const [roomId, game] of activeGames.entries()) {
        safeTimer(io, "sweepFinishedTable", roomId, () => {
          const anyoneConnected = Object.values(game.playerMap).some((uid) =>
            userSocketMap.has(uid)
          );
          if (!anyoneConnected && game.gameState.gameOver) {
            disposeGame(roomId);
          }
        });
      }

      // Rows orphaned by a restart, which the loop above structurally cannot
      // reach: it walks memory, and a restart is what emptied memory.
      void pruneAbandonedGames().catch((err: unknown) =>
        logger.error({ err }, "Pruning abandoned games failed")
      );

      void pruneStaleRooms().catch((err: unknown) =>
        logger.error({ err }, "Pruning stale rooms failed")
      );

      for (const roomId of Array.from(publicRoomIds)) {
        void storage
          .getRoomById(roomId)
          .then((room) => {
            if (!room || room.status !== "waiting") publicRoomIds.delete(roomId);
          })
          .catch((err) =>
            logger.warn(
              { err, roomId },
              "Failed to read the rooms row while sweeping — the public room list keeps a possibly unjoinable entry"
            )
          );
      }
    } catch (err) {
      logger.error({ err }, "Sweeper failed");
    }
  }, SWEEP_INTERVAL_MS);
  (sweeper as unknown as { unref?: () => void }).unref?.();
}

export const gameOverWriters: GameOverWriters = {
  updateRoomStatus: (roomId, status) => storage.updateRoomStatus(roomId, status),
  persistGameState,
  recordGameResult,
  recordRatedResult,
  saveReplay,
};
