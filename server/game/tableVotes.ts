import type { TableRuntime } from "./tableRuntime.ts";
import { emitVoteState, emitEndMatchVoteState } from "./tableBroadcasts.ts";
import { payload } from "../shared/payload.ts";
import { OK, refuse, type Outcome } from "../shared/refusal.ts";
import { logger } from "../shared/logger.ts";
import { activeGames, seatedVoters, type OnlineGameState } from "./gameRoom.ts";
import { endMatchByAgreement } from "./roundOver.ts";
import { vacateSeat } from "./gameTurn.ts";
import { seatOfUser } from "./onlineGameLogic.ts";
import { castEndMatchVote } from "./seatLedger.ts";
import { castRematchVote, clearRematchVotes } from "./matchLedger.ts";
import { dealFirstSeatFor, openingAfter, seatsOf, startRound } from "../../lib/game/gameEngine.ts";
import { dealRound } from "./dealRound.ts";
import type { TableAction } from "./tableActions.ts";

/**
 * Unanimous among the seats a human currently holds — a bot, or a seat whose
 * player left, has nobody who can answer and abstains. The one shape every
 * vote on this table's roster is counted in, so a second vote reuses this
 * rather than its own arithmetic.
 */
export function everySeatedVoted(votes: ReadonlySet<string>, game: OnlineGameState): boolean {
  return seatedVoters(game).every((userId) => votes.has(userId));
}

function rematchAnswered(game: OnlineGameState): boolean {
  return everySeatedVoted(game.rematchVotes, game);
}

/** A match ended by the vote is never rematched (docs/GAME-RULES.md § Decisions). */
function rematchRefused(game: OnlineGameState): boolean {
  return !!game.endedByVote;
}

/**
 * Deals the round the table has voted for, or says why it cannot and leaves
 * every vote where it was.
 *
 * `notifyUserId` is the vote that closed the gate. It is `null` when a seat
 * *leaving* closed it, and then a refusal is logged rather than shown: nobody
 * pressed anything, and the toast would land on whoever happened to be first
 * in `playerMap`.
 */
async function dealVotedRound(
  rt: TableRuntime,
  game: OnlineGameState,
  roomId: string,
  notifyUserId: string | null
): Promise<Outcome> {
  const decline = (code: "ROOM_NOT_FOUND" | "MIN_PLAYERS_REQUIRED"): Outcome => {
    emitVoteState(rt.out.room(roomId), game);
    if (notifyUserId) return refuse(code);
    logger.warn({ roomId, code }, "The next round could not be dealt");
    return { ok: false, code };
  };

  // The database is read for the room's settings and nothing else: the next
  // round's seats are copied from the running game. `room_players` holds
  // humans only, so a roster rebuilt from it drops every bot seat and
  // renumbers whatever is left.
  const room = await rt.store.rooms.getRoomById(roomId);
  // Every gate-closer reaches the read above, so the first one back deals and
  // the rest find the votes it cleared.
  if (!game.gameState.roundOver || !rematchAnswered(game)) return OK;
  if (!room) return decline("ROOM_NOT_FOUND");

  const seats = game.gameState.players;
  if (seats.length < 2) return decline("MIN_PLAYERS_REQUIRED");

  // Cleared only once the next round is certain to be dealt. A vote discarded
  // on the way out of a bail-out can never be retried: the overlay would sit
  // below its own threshold with nothing left to press.
  clearRematchVotes(game);

  // `game.matchOver` still holds the just-ended round's own verdict here —
  // `dealRound` below is what flips it back via `rollMatchForward`.
  const nextFirstSeat = dealFirstSeatFor(game.matchOver, game.dealFirstSeat, seats.length);
  const newGameState = startRound(seatsOf(game.gameState), room.gameMode, {
    firstSeat: nextFirstSeat,
    opening: openingAfter(game.gameState),
  });
  game.dealFirstSeat = nextFirstSeat;

  // `game.playerMap` is deliberately left alone: seat i of the new state is
  // seat i of the old one, because `seatsOf` keeps the seat order. playerMap is
  // what sanitizeStateForPlayer reads to decide whose hand each viewer is sent,
  // so renumbering it here is how a player ends up holding someone else's cards.
  game.maxPlayers = room.maxPlayers;

  await dealRound(rt, game, newGameState);
  return OK;
}

export async function rematchVoteAction(
  rt: TableRuntime,
  game: OnlineGameState,
  action: Extract<TableAction, { kind: "rematchVote" }>
): Promise<Outcome> {
  const { roomId, userId } = action;
  if (!game.gameState.roundOver) return { ok: false, code: "NO_LIVE_GAME" };
  if (seatOfUser(game.playerMap, userId) === null) return { ok: false, code: "NOT_SEATED" };

  // Nobody gets to restart it from the results screen after that.
  if (rematchRefused(game)) return refuse("REMATCH_DECLINED");

  castRematchVote(game, userId);
  emitVoteState(rt.out.room(roomId), game);
  if (!rematchAnswered(game)) return OK;
  return dealVotedRound(rt, game, roomId, userId);
}

/**
 * The unanimous, penalty-free vote to end a match a seat has been vacated
 * from (docs/GAME-RULES.md § Decisions). Offered only once a seat has actually gone —
 * otherwise there is nothing for it to answer — and it carries only when
 * every seat a human still holds has voted; a bot or a vacated seat abstains,
 * the same shape `rematchAnswered` counts.
 */
export async function endMatchVoteAction(
  rt: TableRuntime,
  game: OnlineGameState,
  action: Extract<TableAction, { kind: "endMatchVote" }>
): Promise<Outcome> {
  const { roomId, userId, wants } = action;
  if (seatOfUser(game.playerMap, userId) === null) return { ok: false, code: "NOT_SEATED" };
  if (game.vacatedSeats.size === 0) return { ok: false, code: "NO_VACANCY_TO_END" };

  castEndMatchVote(game, userId, wants);
  emitEndMatchVoteState(rt.out.room(roomId), game);
  if (!wants || !everySeatedVoted(game.endMatchVotes, game)) return OK;

  rt.out.room(roomId).emit("game:notification", {
    type: "info",
    ...payload("MATCH_ENDED_BY_AGREEMENT"),
  });
  await endMatchByAgreement(rt, roomId, game);
  return OK;
}

/**
 * The gate again, after a seat has gone: it counts votes against the seats
 * still there, and a vote is the only thing that ever evaluates it.
 */
export async function dealIfSeatLeftGateClosed(
  rt: TableRuntime,
  roomId: string
): Promise<Outcome> {
  const game = activeGames.get(roomId);
  if (!game || !game.gameState.roundOver || !rematchAnswered(game)) return OK;
  if (rematchRefused(game)) return OK;
  if (Object.keys(game.playerMap).length === 0) return OK;
  return dealVotedRound(rt, game, roomId, null);
}

/**
 * Every seated human who has not voted goes as a disconnect's grace expiry
 * takes a seat — connected or not, which is the ruling — and the rest deal.
 */
export async function expireVoteDeadline(rt: TableRuntime, roomId: string): Promise<void> {
  try {
    const game = activeGames.get(roomId);
    if (!game || !game.gameState.roundOver || game.matchOver || rematchRefused(game)) return;
    const silent = Object.values(game.playerMap).filter((userId) => !game.rematchVotes.has(userId));
    // Votes keep landing through every await below, so each seat is judged
    // again just before it goes, and leaves the map before its row is released.
    for (const userId of silent) {
      if (activeGames.get(roomId) !== game || !game.gameState.roundOver) break;
      if (game.rematchVotes.has(userId)) continue;
      await vacateSeat(rt, roomId, userId);
      const released = await rt.store.rooms.releaseSeat(roomId, userId).catch((err) => {
        logger.warn(
          { err, roomId, userId },
          "Failed to delete the room_players row after the vote deadline — the seat stays counted as taken"
        );
        return null;
      });
      // A rejoin inside the release reclaims the seat and upserts before the delete commits.
      const reclaimed = seatOfUser(game.playerMap, userId);
      if (reclaimed !== null) {
        await rt.store.rooms
          .restoreSeat(roomId, userId, reclaimed, released?.wasHost ?? false)
          .catch((err: unknown) =>
            logger.warn({ err, roomId, userId }, "Failed to restore a seat reclaimed during the vote deadline's release")
          );
      }
    }
    await dealIfSeatLeftGateClosed(rt, roomId);
    logger.info({ roomId, vacated: silent }, "Next-round vote deadline expired");
  } catch (err) {
    logger.error({ err, roomId }, "Vote deadline handler failed");
  }
}
