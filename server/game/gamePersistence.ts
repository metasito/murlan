import { logger } from "../shared/logger.ts";
import { commitRoundResults } from "./roundResults.ts";
import { sweepRetention } from "./retention.ts";
import { activeGames } from "./gameRoom.ts";
import { payload } from "../shared/payload.ts";
import { now } from "../http/clock.ts";
import type { OnlineGameState } from "./gameRoom.ts";
import type { TableRuntime, TableStore, TableWriters } from "./tableRuntime.ts";
import type { AppliedResults } from "./roundOver.ts";
import { ownerEpochOf, ownsRoom, releaseRoomAfter, unclaimedRooms, writeAsOwner } from "./gameOwnership.ts";
import { allRoomWritesLanded, queueBarrier, queueSnapshot, roomWritesLanded } from "./roomWriteChain.ts";
import {
  sweepIntervalMs,
  clearRoomTimers,
  clearRoomDisconnectTimers,
  clearRoomLobbyGraces,
  secondsUntil,
  stopArming,
} from "./gameTimers.ts";
import {
  seatOfUser,
  visibleExchangePhase,
  markExchangeSettled,
} from "./onlineGameLogic.ts";
import { toEnvelope } from "./tableState.ts";
import type { GameState, Card } from "../../lib/game/gameEngine.ts";
import { turnOf } from "../../lib/game/moves.ts";
import type { ViewerGameState } from "../../shared/protocol.ts";

export function sanitizeStateForPlayer(
  state: GameState,
  viewerUserId: string,
  playerMap: Readonly<Record<number, string>>,
  turnDeadlineMs?: number,
  vacatedSeats?: ReadonlyMap<number, { userId: string; username: string }>
): ViewerGameState {
  // The server knows which seat the viewer occupies authoritatively; ship it
  // with every state so the client never has to derive it (e.g. from a lobby
  // `room` object that is null across a cold-start rejoin).
  const viewerSeatIndex = seatOfUser(playerMap, viewerUserId);
  return {
    ...state,
    viewerSeatIndex,
    // Seconds rather than the deadline itself: a device whose clock is off by
    // minutes would render an absolute timestamp as a clock that is already
    // over or never moves. The deadline rides along only as a reset key.
    turnDeadlineMs,
    turnSecondsRemaining: secondsUntil(turnDeadlineMs),
    turn: turnOf(state),
    exchangePhase: visibleExchangePhase(state.exchangePhase, viewerSeatIndex, now()),
    players: state.players.map((p, idx) => {
      const isViewer = playerMap[idx] === viewerUserId;
      return {
        ...p,
        hand: isViewer ? p.hand : ([] as Card[]),
        handCount: p.hand.length,
        // The flag travels, never the text (docs/GAME-RULES.md § Decisions): `name` is
        // still the person's real name, and each client renders the
        // departed label itself, through `t()`, in its own locale.
        vacated: vacatedSeats?.has(idx) ?? false,
      };
    }),
  };
}

/**
 * Drops every in-memory trace of a room. The room is handed back only once its writes have
 * landed: a claim landing first restores the table from a row this process is still writing, or
 * has yet to delete.
 */
export function disposeGame(rt: TableRuntime, roomId: string, deleteRow = true) {
  const game = activeGames.get(roomId);
  if (game) clearRoomDisconnectTimers(game);
  clearRoomTimers(roomId);
  clearRoomLobbyGraces(roomId);
  activeGames.delete(roomId);
  const discarded = deleteRow ? rt.writers.discardGame(roomId) : undefined;
  void releaseRoomAfter(roomId, Promise.all([discarded, roomWritesLanded(roomId)]));
}

/**
 * Ends play on every table this process holds — nothing armed on one fires
 * again — and waits for the writes already queued, a closed table's status and
 * row delete among them. The games stay in memory, so those writes still land.
 */
export async function stopTables(): Promise<void> {
  stopArming();
  for (const [roomId, game] of activeGames) {
    clearRoomDisconnectTimers(game);
    clearRoomTimers(roomId);
    clearRoomLobbyGraces(roomId);
  }
  await allRoomWritesLanded();
}

/**
 * The table's writers over `store`: the only code that writes a table's
 * `active_games` row or its room's status, beside the claim's epoch move
 * (`enterTable`). They land in the order they were made (`roomWriteChain.ts`), each row
 * write under the claim's epoch; none of them writes for a table this process lost.
 */
export function tableWriters(store: TableStore): TableWriters {
  return {
    updateRoomStatus: (roomId, status) =>
      queueBarrier(roomId, async () => {
        if (ownsRoom(roomId)) await store.rooms.updateRoomStatus(roomId, status);
      }),
    persistGameState(roomId, game) {
      return queueSnapshot(roomId, async () => {
        // Judged when the write runs, not when it was queued: a table disposed in
        // between has had its row deleted, or handed to another instance.
        if (activeGames.get(roomId) !== game) return;
        // Packed when it runs too: a round whose results committed meanwhile must not be written back.
        const gameState = toEnvelope(game);
        await writeAsOwner(roomId, (epoch) => store.games.write(roomId, gameState, epoch)).catch(
          (err: unknown) => logger.error({ err, roomId }, "Failed to persist game state")
        );
      });
    },
    persistFinalState(roomId, game) {
      const entry = game.pendingResults.at(-1);
      // Packed when it runs, and written even once the table is disposed: it is the only copy of the round's results.
      return queueBarrier(roomId, async () => {
        if (!entry || !game.pendingResults.includes(entry)) return;
        const wrote = await writeAsOwner(roomId, (epoch) => store.games.write(roomId, toEnvelope(game), epoch, entry)).catch(
          (err: unknown) => {
            logger.error({ err, roomId }, "Failed to persist a finished round");
            return false;
          }
        );
        if (wrote) game.landedResults.add(entry.round);
      });
    },
    applyPendingResults: (roomId, game) => queueBarrier(roomId, () => applyPending(store, roomId, game)),
    discardGame: (roomId) =>
      queueBarrier(roomId, () =>
        writeAsOwner(roomId, (epoch) => store.games.remove(roomId, epoch)).catch((err: unknown) =>
          logger.error({ err, roomId }, "Failed to delete persisted game")
        )
      ),
  };
}

/**
 * Commits the game's pending rounds oldest first, each removed from memory in the same tick its
 * commit lands, and stops at the first failure. A round is written to the row first unless it is
 * known to be there: only a round the row held can be read as applied when the row lacks it, or
 * when the row is gone.
 */
async function applyPending(store: TableStore, roomId: string, game: OnlineGameState): Promise<AppliedResults> {
  const applied: AppliedResults["applied"] = [];
  const live = () => activeGames.get(roomId) ?? game;
  try {
    for (let entry = game.pendingResults[0]; entry; entry = game.pendingResults[0]) {
      const current = entry;
      const out: { ratings: AppliedResults["applied"][number]["ratings"] } = { ratings: null };
      const owned = await writeAsOwner(roomId, async (epoch) => {
        if (!game.landedResults.has(current.round)) {
          if (!(await store.games.write(roomId, toEnvelope(game), epoch, current))) return false;
          game.landedResults.add(current.round);
        }
        const markFinished = live().gameState.roundOver && game.pendingResults.at(-1) === current;
        const commit = await commitRoundResults(store.games, roomId, epoch, current, { markFinished });
        if (commit.kind === "committed") {
          out.ratings = commit.ratings;
          return true;
        }
        // No delete takes a row that still holds a round, so a missing row lost it to the commit, as ours does.
        const found = await store.games.epochOf(roomId);
        return found === epoch || found === undefined;
      });
      if (!owned) return { applied, held: false };
      game.pendingResults.splice(game.pendingResults.indexOf(current), 1);
      game.landedResults.delete(current.round);
      applied.push({ entry: current, ratings: out.ratings });
    }
    return { applied, held: true };
  } catch (failure) {
    return { applied, held: true, failure };
  }
}

/**
 * Sends one player the table as they are allowed to see it, and sends it again
 * if they do not say it arrived.
 *
 * `sanitizeStateForPlayer` ships a whole snapshot, so a dropped `game:state` is
 * corrected by the next one — except for the last of a round, and for the one
 * answering a rejoin. Those have nothing coming after them, and a player who
 * misses one is left looking at a table that will never right itself.
 *
 * One retry, not a stream: the socket's own reconnect and `game:rejoin` are what
 * recover a client that is genuinely gone, and shouting at it meanwhile only
 * competes with them.
 *
 * The retry re-derives from whatever is live now rather than replaying the
 * snapshot it was called with. That is what makes it safe: by the time it fires
 * the round may have moved on, and re-sending the older state would rewind the
 * player's table rather than repair it.
 */
export function sendGameStateTo(rt: TableRuntime, uid: string, game: OnlineGameState) {
  rt.out.state(uid, (retrying) => {
    // A retry for a table that has since ended has nothing to say. `game` is
    // still in scope, but it holds the state as it was, which is exactly what
    // must not go out.
    const live = retrying ? activeGames.get(game.roomId) : game;
    if (!live) return null;
    return {
      ...sanitizeStateForPlayer(live.gameState, uid, live.playerMap, live.turnDeadlineMs, live.vacatedSeats),
      roomId: live.roomId,
      epoch: ownerEpochOf(live.roomId) ?? 0,
      seq: ++live.seq,
    };
  });
}

/**
 * Serves every viewer, then persists. The one way a changed table is published;
 * the persist promise is returned so a disposer can order itself after it.
 */
export function publishState(rt: TableRuntime, game: OnlineGameState): Promise<unknown> {
  serveState(rt, game);
  return rt.writers.persistGameState(game.roomId, game);
}

/** `publishState`'s sends alone, for the move that ends a round: its row write is the round's final write. */
export function serveState(rt: TableRuntime, game: OnlineGameState): void {
  // Before the first seat is served, so the broadcast that closes an exchange
  // is inside its own ceremony window rather than one tick outside it.
  const at = now();
  markExchangeSettled(game.gameState.exchangePhase, at);
  if (game.gameState.lastMove.kind === "deal") game.gameState.dealtAt ??= at;
  Object.values(game.playerMap).forEach((uid) => sendGameStateTo(rt, uid, game));
  // Spectators go through the same sanitiser. seatOfUser returns null for
  // a userId that holds no seat, and every hand is blanked on that basis, so a
  // spectator cannot be sent a card without the seated path breaking first.
  game.spectators.forEach((uid) => sendGameStateTo(rt, uid, game));
}

export type CloseNotice = "GAME_INTERRUPTED_SERVER_ERROR" | "GAME_INTERRUPTED_EMPTY_SEAT";

/**
 * The one "close the table": announced, marked finished, disposed, all in this
 * tick — a table waiting on the database would go on taking moves.
 */
export function closeTable(rt: TableRuntime, roomId: string, notice: CloseNotice | null): void {
  if (notice) rt.out.room(roomId).emit("game:notification", { type: "abandoned", ...payload(notice) });
  void rt.writers
    .updateRoomStatus(roomId, "finished")
    .catch((err: unknown) => logger.warn({ err, roomId, notice }, "Failed to set rooms.status = finished closing a table"));
  disposeGame(rt, roomId);
}

/**
 * Runs a timer body under the same contract `onEvent` gives an inbound event: a
 * throw degrades to a closed table rather than escaping the callback.
 *
 * The containment is load-bearing rather than tidy. `armTurn` clears the turn's
 * timers before it arms the next one, and it is only ever reached from a move, a
 * rejoin, a disconnect or another timer — so a throw inside a timer body leaves
 * the room with nothing pending and nothing that will ever re-arm it. The table
 * stops on a turn that cannot be taken, and the client's clock has no `onExpire`
 * to notice. Closing the table loudly is the recoverable outcome.
 */
export function safeTimer(rt: TableRuntime, label: string, roomId: string, fn: () => void): void {
  try {
    fn();
  } catch (err) {
    logger.error({ err, roomId, label }, "Timer callback threw — closing table");
    closeTable(rt, roomId, "GAME_INTERRUPTED_SERVER_ERROR");
  }
}

let sweeper: ReturnType<typeof setInterval> | null = null;

/**
 * Drops finished tables nobody is still looking at.
 *
 * "Nobody" is asked of the cluster, not of `userSocketMap`: the instance that
 * owns a table need not be the one holding its players' sockets, so a local
 * read sees a table full of people as empty and deletes the game out from under
 * their results screen. A cluster that did not answer disposes nothing.
 */
export async function sweepFinishedTables(rt: TableRuntime): Promise<void> {
  const finished = [...activeGames.entries()].filter(([, game]) => game.gameState.roundOver);
  if (finished.length === 0) return;
  const connected = await rt.presence.connectedUserIds();
  if (!connected) return;
  for (const [roomId, game] of finished) {
    safeTimer(rt, "sweepFinishedTable", roomId, () => {
      if (!Object.values(game.playerMap).some((uid) => connected.has(uid))) {
        // Queued ahead of the discard, which keeps the row while a round is still pending in it.
        if (game.pendingResults.length > 0) {
          void rt.writers.applyPendingResults(roomId, game).then(({ failure }) => {
            if (failure !== undefined) logger.error({ err: failure, roomId }, "A swept table's results failed to commit — the row keeps them");
          });
        }
        disposeGame(rt, roomId);
      }
    });
  }
}

/**
 * Long-running server hygiene: drop finished tables nobody is connected to and
 * forget public rooms that are no longer joinable.
 */
export function startSweeper(rt: TableRuntime, resumeOrphans: (rt: TableRuntime) => Promise<void>) {
  if (sweeper) return;
  let sweeping = false;
  sweeper = setInterval(() => {
    try {
      // Only reachable through a bug — every path that puts a game in memory
      // claims the room first — but what it would be reporting is two
      // instances broadcasting one table over each other, which is worth a
      // loud line rather than a silent divergence.
      const unclaimed = unclaimedRooms();
      if (unclaimed.length > 0) {
        logger.error({ rooms: unclaimed }, "Holding games for rooms this instance does not own");
      }

      if (sweeping) return;
      sweeping = true;
      void Promise.allSettled([
        resumeOrphans(rt).catch((err: unknown) => logger.error({ err }, "Resuming ownerless tables failed")),
        sweepFinishedTables(rt).catch((err: unknown) => logger.error({ err }, "Sweeping finished tables failed")),
        sweepRetention(),
      ]).finally(() => {
        sweeping = false;
      });
    } catch (err) {
      sweeping = false;
      logger.error({ err }, "Sweeper failed");
    }
  }, sweepIntervalMs());
  (sweeper as unknown as { unref?: () => void }).unref?.();
}


