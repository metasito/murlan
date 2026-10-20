// server/game/tableHandlers.ts — what the instance that owns a table does when one
// of its players acts: the dispatcher, seat loss and rejoin. Moves, votes and a
// table's entry into memory each have their own module (tableMoves, tableVotes,
// tableLifecycle).
//
// These run on the owner, which is not necessarily where the player's socket
// is: everything they say goes to `rt.out.user(userId)` rather than to a
// socket object, exactly as `gameRoom.ts` describes. A `socket.emit` here would
// reach the player only when they happened to be connected to the instance
// that dealt.
//
// The socket's own work — joining a room, `socketRoomMap` — stays with the
// socket, in the handler families. The play and disconnect chains through these
// files: docs/ARCHITECTURE.md and docs/DISCONNECT-POLICY.md.
import type { TableRuntime } from "./tableRuntime.ts";
import { emitEndMatchVoteState } from "./tableBroadcasts.ts";
import { payload } from "../shared/payload.ts";
import { OK, type Outcome } from "../shared/refusal.ts";
import { logger } from "../shared/logger.ts";
import { trackEvent } from "../shared/events.ts";
import { activeGames, isShuttingDown, seatName } from "./gameRoom.ts";
import type { OnlineGameState } from "./gameRoom.ts";
import { publishState, sendGameStateTo } from "./gamePersistence.ts";
import { armTurnIfIdle, vacateSeat } from "./gameTurn.ts";
import { disconnectGraceMs, clearDisconnectGrace, clearLobbyGrace, arm } from "./gameTimers.ts";
import { seatOfUser } from "./onlineGameLogic.ts";
import { reclaim } from "./seatLedger.ts";
import { announceRejoin, armLobbyGrace } from "../socket/socketTable.ts";
import type { TableAction } from "./tableActions.ts";
import { UNKNOWN_ACTION } from "./tableRouter.ts";
import { moveAction } from "./tableMoves.ts";
import { dealIfSeatLeftGateClosed, endMatchVoteAction, rematchVoteAction } from "./tableVotes.ts";
import { startMatchAction } from "./tableLifecycle.ts";

async function rejoinAction(
  rt: TableRuntime,
  game: OnlineGameState,
  action: Extract<TableAction, { kind: "rejoin" }>
): Promise<Outcome> {
  const { roomId, userId } = action;
  let seat = seatOfUser(game.playerMap, userId);
  if (seat === null) {
    seat = reclaim(game, userId);
    if (seat === null) {
      // Reachable only on a restored row that kept `releasedSeats` and lost the
      // seat entry: `seatLedger.ts` writes and clears the two together.
      const code = game.releasedSeats.has(userId) ? "SEAT_RELEASED" : "UNAUTHORIZED";
      return { ok: false, code };
    }
    // Every viewer's own `vacated` flag for this seat must flip false, and
    // the returning player's hand — still theirs; `vacateSeat` never touched
    // it — has to reach them. A normal reconnect skips this: the seat was
    // never vacated on the wire in the first place.
    void publishState(rt, game);
    // reclaim clears the (now-stale) end-match tally; every seat still
    // holding a vote for it has to be told, or its banner keeps counting a
    // vote the server no longer has.
    emitEndMatchVoteState(rt.out.room(roomId), game);
  }

  // The grace timer lives on whichever instance saw the socket go, and the
  // player may well have come back on another one. Clearing it here is what
  // makes the answer independent of that.
  clearDisconnectGrace(userId);
  clearLobbyGrace(roomId, userId);

  // Idempotent — an INSERT on every reconnect would pile up duplicate
  // room_players rows and corrupt the next rematch.
  await rt.store.rooms
    .upsertRoomPlayer(roomId, userId, seat)
    .catch((err: unknown) => logger.warn({ err, roomId, userId }, "upsertRoomPlayer failed"));

  await announceRejoin(rt, userId, roomId, game);
  logger.info({ userId, roomId }, "Player rejoined game");
  return OK;
}


/**
 * A seated player's socket went away, on whichever instance was holding it.
 *
 * The decision needs the game, so it is made here rather than where the socket
 * dropped: on the instance that held no copy of the table, the same code read
 * a round in progress as a waiting lobby and released the seat outright.
 */
async function seatLostAction(
  rt: TableRuntime,
  game: OnlineGameState,
  action: Extract<TableAction, { kind: "seatLost" }>
): Promise<Outcome> {
  const { roomId, userId } = action;
  // Every socket drops at a shutdown, and the next process restores this table
  // from active_games and arms the graces itself.
  if (isShuttingDown()) return OK;
  // Forwarded from another instance, this can land after the player's rejoin
  // has already cleared the graces it would arm. Between hands the seat holds
  // the rematch gate, so only a socket back in this room counts.
  const back = game.gameState.roundOver
    ? await rt.presence.isAtTable(userId, roomId)
    : await rt.presence.isOnline(userId);
  if (back) return OK;
  const seat = seatOfUser(game.playerMap, userId);
  if (seat === null) return { ok: false, code: "NOT_SEATED" };

  if (!game.gameState.roundOver) {
    // Distinct from losing: the hand was still running when they went.
    trackEvent("game.abandoned", userId, {
      playerCount: game.gameState.players.length,
      gameMode: game.gameState.gameMode,
    });
  }
  const releasing = armSeatGrace(rt, game, roomId, userId, seat);
  return releasing ? releasing.then(() => OK) : OK;
}

/** Holds an absent player's seat for its grace, and hands it on when that runs out. */
export function armSeatGrace(
  rt: TableRuntime,
  game: OnlineGameState,
  roomId: string,
  userId: string,
  seat: number
): Promise<void> | void {
  const username = seatName(game, seat);

  if (game.gameState.roundOver) {
    // The lobby grace, not the disconnect one: a seat between rounds counts
    // towards the rematch gate, so the table cannot wait a full minute on it.
    // Its expiry also asks the right question — back in *this* room, not
    // merely back online.
    return armLobbyGrace(rt, roomId, userId);
  }

  const graceSeconds = Math.round(disconnectGraceMs() / 1000);
  rt.out.room(roomId).emit("game:player_disconnected", {
    userId,
    username,
    seatIndex: seat,
    ...payload("PLAYER_DISCONNECTED_GRACE", { username, seconds: graceSeconds }),
  });

  // A vacant seat must keep playing while we wait, or the table stalls for a
  // full minute on this player's turn.
  armTurnIfIdle(rt, roomId);

  arm("disconnect", userId, disconnectGraceMs(), () => {
    void (async () => {
      try {
        // Asked of the cluster, not of this process: the instance that owns a
        // table need not be the one holding the player's socket, and reading
        // the local map alone hands a connected player's seat to a bot.
        if (await rt.presence.isOnline(userId)) return;

        await rt.store.rooms
          .releaseSeat(roomId, userId)
          .catch((err) =>
            logger.warn(
              { err, roomId, userId },
              "Failed to delete the room_players row after the disconnect grace expired — the seat stays counted as taken"
            )
          );
        await vacateSeat(rt, roomId, userId);
        // The round may well have ended inside the grace, which puts this seat
        // in the rematch tally it is now leaving.
        await dealIfSeatLeftGateClosed(rt, roomId);
        logger.info({ userId, username, roomId }, "Disconnect grace expired — seat handed to a bot");
      } catch (err) {
        logger.error({ err, userId, roomId }, "Disconnect timeout handler failed");
      }
    })();
  });
}

export async function applyTableAction(rt: TableRuntime, action: TableAction): Promise<Outcome> {
  if (action.kind === "startMatch") return startMatchAction(rt, action);

  const game = activeGames.get(action.roomId);
  if (!game) return { ok: false, code: "NO_LIVE_GAME" };

  switch (action.kind) {
    case "move":
      return moveAction(rt, game, action);
    case "reaction": {
      const seat = seatOfUser(game.playerMap, action.userId);
      if (seat === null) return { ok: false, code: "NOT_SEATED" };
      rt.out.room(action.roomId).emit("game:reaction", {
        emoji: action.emoji,
        fromSeat: seat,
        username: seatName(game, seat),
      });
      return OK;
    }
    case "rematchVote":
      return rematchVoteAction(rt, game, action);
    case "endMatchVote":
      return endMatchVoteAction(rt, game, action);
    case "rejoin":
      return rejoinAction(rt, game, action);
    case "spectate": {
      if (game.gameState.roundOver) return { ok: false, code: "GAME_NOT_FOUND" };
      // A seated player watching their own table would be handed the seatless
      // view and lose sight of their own hand.
      if (seatOfUser(game.playerMap, action.userId) !== null) {
        return { ok: false, code: "ALREADY_IN_ROOM" };
      }
      game.spectators.add(action.userId);
      sendGameStateTo(rt, action.userId, game);
      logger.info({ roomId: action.roomId, userId: action.userId }, "Spectator joined");
      return OK;
    }
    case "unspectate":
      game.spectators.delete(action.userId);
      return OK;
    case "seatLost":
      return seatLostAction(rt, game, action);
    case "resume":
      armTurnIfIdle(rt, action.roomId);
      return OK;
    case "vacate":
      // `rooms.status` reads "finished" between rounds too, so only the live
      // game knows whether the seat is still held. Removing the DB row alone
      // leaves it live — auto-playing the leaver's hand, or blocking the
      // rematch gate.
      return vacateSeat(rt, action.roomId, action.userId).then(
        () => dealIfSeatLeftGateClosed(rt, action.roomId)
      );
    default:
      action satisfies never;
      // A newer revision forwards kinds this one has never heard of.
      return UNKNOWN_ACTION;
  }
}
