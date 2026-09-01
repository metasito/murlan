import type { Server as SocketServer } from "socket.io";
import { eq, inArray, lt } from "drizzle-orm";
import { storage } from "./storage.ts";
import { logger } from "./logger.ts";
import { db } from "./db.ts";
import { recordGameResult } from "./stats.ts";
import { previewRatedDeltas, recordRatedResult } from "./ratings.ts";
import { saveReplay } from "./replays.ts";
import {
  activeGames as activeGamesTable,
  roomPlayers as roomPlayersTable,
  rooms as roomsTable,
} from "../shared/schema.ts";
import { activeGames, userRoom } from "./gameRoom.ts";
import type { OnlineGameState } from "./gameRoom.ts";
import type { GameOverWriters } from "./gameOver.ts";
import { releaseRoom, unclaimedRooms } from "./gameOwnership.ts";
import {
  STATE_ACK_TIMEOUT_MS,
  SWEEP_INTERVAL_MS,
  clearRoomTimers,
  clearRoomDisconnectTimers,
  secondsUntil,
} from "./gameTimers.ts";
import {
  findViewerSeat,
  visibleExchangePhase,
  markExchangeSettled,
  packPersistedState,
} from "./onlineGameLogic.ts";
import type { GameState, Card } from "../lib/gameEngine.ts";

/**
 * How long an `active_games` row may sit untouched before it is abandoned.
 *
 * Every path that deletes a row walks the in-memory `activeGames`, which a
 * restart empties — so a game live when the process went down, and never
 * rejoined, is invisible to all of them. On a host that sleeps, that is every
 * sleep with a game open.
 *
 * A day is far past any live game: `persistGameState` refreshes `updated_at`
 * on every move. The margin is so a rejoinable row is never taken from under
 * a player.
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
  // Handed back the moment the game leaves memory: the claim is what keeps
  // every other instance off this room, and a lock outliving the table it
  // protected is a room nobody can ever take over.
  void releaseRoom(roomId);
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
    gameState: packPersistedState(game.gameState, game.handFlags, game.dealFirstSeat, game.joinCode, {
      playerMap: game.playerMap,
      scores: game.cumulativeScores,
      gameMode: game.gameMode,
      matchLength: game.matchLength,
      matchTarget: game.matchTarget,
      maxPlayers: game.maxPlayers,
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

/**
 * Sends one player the table as they are allowed to see it, and sends it again
 * if they do not say it arrived.
 *
 * `sanitizeStateForPlayer` ships a whole snapshot, so a dropped `game:state` is
 * corrected by the next one — except for the last of a hand, and for the one
 * answering a rejoin. Those have nothing coming after them, and a player who
 * misses one is left looking at a table that will never right itself.
 *
 * One retry, not a stream: the socket's own reconnect and `game:rejoin` are what
 * recover a client that is genuinely gone, and shouting at it meanwhile only
 * competes with them.
 *
 * The retry re-derives from whatever is live now rather than replaying the
 * snapshot it was called with. That is what makes it safe: by the time it fires
 * the hand may have moved on, and re-sending the older state would rewind the
 * player's table rather than repair it.
 */
export function sendGameStateTo(io: SocketServer, uid: string, game: OnlineGameState) {
  const send = (retrying: boolean) => {
    // A retry for a table that has since ended has nothing to say. `game` is
    // still in scope, but it holds the state as it was, which is exactly what
    // must not go out.
    const live = retrying ? activeGames.get(game.roomId) : game;
    if (!live) return;
    io.to(userRoom(uid))
      .timeout(STATE_ACK_TIMEOUT_MS)
      .emit(
        "game:state",
        sanitizeStateForPlayer(live.gameState, uid, live.playerMap, live.turnDeadlineMs),
        (err: unknown) => {
          if (err && !retrying) send(true);
        }
      );
  };
  send(false);
}

export function broadcastGameState(io: SocketServer, game: OnlineGameState) {
  // Before the first seat is served, so the broadcast that closes an exchange
  // is inside its own ceremony window rather than one tick outside it.
  markExchangeSettled(game.gameState.exchangePhase);
  Object.values(game.playerMap).forEach((uid) => sendGameStateTo(io, uid, game));
  // Spectators go through the same sanitiser. findViewerSeat returns null for
  // a userId that holds no seat, and every hand is blanked on that basis, so a
  // spectator cannot be sent a card without the seated path breaking first.
  game.spectators.forEach((uid) => sendGameStateTo(io, uid, game));
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
      message: "Game interrupted: a server error.",
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
 * Drops finished tables nobody is still looking at.
 *
 * "Nobody" is asked of the cluster, not of `userSocketMap`: the instance that
 * owns a table need not be the one holding its players' sockets, so a local
 * read sees a table full of people as empty and deletes the game out from under
 * their results screen. `fetchSockets()` answers from the local rooms when
 * there is only one instance, so this costs a round trip only when there is
 * someone to ask.
 */
async function sweepFinishedTables(io: SocketServer): Promise<void> {
  const finished = [...activeGames.entries()].filter(([, game]) => game.gameState.gameOver);
  if (finished.length === 0) return;
  const connected = new Set(
    (await io.fetchSockets())
      .map((s) => s.data?.userId)
      .filter((id): id is string => typeof id === "string")
  );
  for (const [roomId, game] of finished) {
    safeTimer(io, "sweepFinishedTable", roomId, () => {
      if (!Object.values(game.playerMap).some((uid) => connected.has(uid))) {
        disposeGame(roomId);
      }
    });
  }
}

/**
 * Long-running server hygiene: drop finished tables nobody is connected to and
 * forget public rooms that are no longer joinable.
 */
export function startSweeper(io: SocketServer) {
  if (sweeper) return;
  sweeper = setInterval(() => {
    try {
      void sweepFinishedTables(io).catch((err: unknown) =>
        logger.error({ err }, "Sweeping finished tables failed")
      );

      // Rows orphaned by a restart, which the loop above structurally cannot
      // reach: it walks memory, and a restart is what emptied memory.
      void pruneAbandonedGames().catch((err: unknown) =>
        logger.error({ err }, "Pruning abandoned games failed")
      );

      void pruneStaleRooms().catch((err: unknown) =>
        logger.error({ err }, "Pruning stale rooms failed")
      );

      // Only reachable through a bug — every path that puts a game in memory
      // claims the room first — but what it would be reporting is two
      // instances broadcasting one table over each other, which is worth a
      // loud line rather than a silent divergence.
      const unclaimed = unclaimedRooms();
      if (unclaimed.length > 0) {
        logger.error({ rooms: unclaimed }, "Holding games for rooms this instance does not own");
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
  previewRatedDeltas,
  saveReplay,
};
