import type { SocketServer } from "../socket/socketTypes.ts";
import { roomStore } from "../store/roomStore.ts";
import { emitVoteState } from "../socket/emit.ts";
import { logger } from "../http/logger.ts";
import { DEFAULT_LOCALE, translate } from "../../shared/i18n.ts";
import { activeGames, seatName } from "./gameRoom.ts";
import { seatOfUser } from "./onlineGameLogic.ts";
import { vacate } from "./seatLedger.ts";
import { payload } from "../socket/payload.ts";
import type { OnlineGameState } from "./gameRoom.ts";
import {
  afkTimers,
  botTimers,
  afkTimeoutMs,
  botMoveDelayMs,
  clearAfkTimer,
  clearRoomTimers,
  secondsUntil,
} from "./gameTimers.ts";
import {
  broadcastGameState,
  disposeGame,
  roundOverWriters,
  persistGameState,
  safeTimer,
} from "./gamePersistence.ts";
import { handleRoundOver, voidAbandonedMatch, type RoundOverWriters } from "./roundOver.ts";
import { appendReplayMove } from "./replayShape.ts";
import {
  autoMoveForSeat as sharedAutoMove,
  recordPlayFlags as recordFlags,
} from "../../lib/game/autoMove.ts";
import { roundUnplayed, openingIsPending } from "../../lib/game/gameEngine.ts";
import type { GameState, Combination } from "../../lib/game/gameEngine.ts";
import { Reading } from "../../lib/tokens.ts";
import { exchangeAnnounceMs } from "../../lib/exchangeCeremony.ts";
import { exchangeGiveDelayMs } from "../../lib/game/exchangeTimeline.ts";
import { handCountOf } from "../../shared/protocol.ts";

/** The seat that must act right now: the exchange winner, or the turn holder. */
function actingSeat(state: GameState): number {
  return state.exchangePhase?.active
    ? state.exchangePhase.winnerIdx
    : state.currentTurnIndex;
}

export type AutoMovable = Pick<OnlineGameState, "gameState" | "roundFlags" | "moveLog">;

/** See lib/game/autoMove.ts. Kept here so the human `game:play` path has one import. */
export function recordPlayFlags(game: AutoMovable, seat: number, combo: Combination) {
  recordFlags(game.roundFlags, seat, combo);
}

/** A move for the replay log: `combo` null is a pass. */
export interface CommittedMove {
  seat: number;
  combo: Combination | null;
}

/**
 * One automated action for a seat — the shared rule, given this table's flags.
 * `move` is null when the action was an exchange, which the replay does not log.
 */
export function autoMoveForSeat(
  game: AutoMovable,
  seat: number,
  useBot: boolean
): { next: GameState; move: CommittedMove | null } | null {
  let move: CommittedMove | null = null;
  const next = sharedAutoMove(game.gameState, seat, useBot, {
    roundFlags: game.roundFlags,
    onMove: (movedSeat, combo) => {
      move = { seat: movedSeat, combo };
    },
  });
  return next && { next, move };
}

/**
 * The one way a move lands on a live table: logged for the replay, sent,
 * persisted, then the next seat armed — or, when it ended the round, the
 * round-over handoff, whose promise is returned.
 */
export function commitMove(
  io: SocketServer,
  game: OnlineGameState,
  next: GameState,
  move: CommittedMove | null
): Promise<void> | undefined {
  if (move) appendReplayMove(game, move.seat, move.combo, next);
  const prev = game.gameState;
  game.gameState = next;
  broadcastGameState(io, game);
  persistGameState(game.roomId, game);
  if (next.roundOver) return handleRoundOver(io, game.roomId, game, roundOverWriters);
  armAfterMove(io, game.roomId, prev);
}

/**
 * Tells the table how long the acting seat has left. Sent on its own as well
 * as with the state, because the AFK window is re-armed on paths that change
 * no state at all — every rejoin and every disconnect — and a clock that ran
 * to zero while the server still held a full window reads as a frozen table.
 */
function emitTurnDeadline(io: SocketServer, roomId: string, game: OnlineGameState) {
  io.to(roomId).emit("game:turn_deadline", {
    turnDeadlineMs: game.turnDeadlineMs,
    turnSecondsRemaining: secondsUntil(game.turnDeadlineMs),
  });
}

/**
 * Single scheduler for "whose move is it". Called after every state change, so
 * the AFK chain never breaks and a vacated seat is always resolvable:
 *   seat has a user  -> arm that user's AFK timer
 *   seat is vacant   -> a bot plays it after a short delay
 *
 * `botDelayMs` is that delay. A move the table is still watching an animation
 * for has to lengthen it, or the bot plays over the ceremony announcing the
 * move before it.
 */
export function armTurn(io: SocketServer, roomId: string, botDelayMs = botMoveDelayMs()) {
  const game = activeGames.get(roomId);
  if (!game) return;

  clearRoomTimers(roomId);
  if (game.gameState.roundOver) {
    game.turnDeadlineMs = undefined;
    return;
  }

  const seat = actingSeat(game.gameState);
  const userId = game.playerMap[seat];

  if (userId === undefined) {
    game.turnDeadlineMs = undefined;
    const phase = game.gameState.exchangePhase;
    const exchangeOnTable = phase?.active || (phase?.twoJokerException && roundUnplayed(game.gameState));
    const delayMs = exchangeOnTable
      ? Math.max(botDelayMs, exchangeGiveDelayMs(game.gameState.players.map(handCountOf)))
      : botDelayMs;
    botTimers.set(
      roomId,
      setTimeout(() => {
        botTimers.delete(roomId);
        safeTimer(io, "botTurn", roomId, () => runBotTurn(io, roomId));
      }, delayMs)
    );
    emitTurnDeadline(io, roomId, game);
    return;
  }

  const username = game.gameState.players[seat]?.name ?? "";
  // The opener's own client holds the table behind the opening announcement
  // for Reading.notice before it can act — an online-only cost, since the
  // client draws that gate from state the server already dealt (startReason)
  // rather than a message announcing it. Granted once, on the turn
  // `openingIsPending` names: the opener's first play of the round, never a
  // seat replaying a turn it already spent its grant on.
  const openingGraceMs = openingIsPending(game.gameState) ? Reading.notice : 0;
  const timeoutMs = afkTimeoutMs() + openingGraceMs;
  game.turnDeadlineMs = Date.now() + timeoutMs;
  startAfkTimer(io, roomId, userId, username, timeoutMs);
  emitTurnDeadline(io, roomId, game);
}

/** Every move re-arms here, so an exchange's ceremony holds the next seat on each path that closes it. */
export function armAfterMove(io: SocketServer, roomId: string, prev: GameState) {
  const phase = prev.exchangePhase;
  armTurn(io, roomId, phase?.active ? exchangeAnnounceMs(phase.twoJokerException === true) : botMoveDelayMs());
}

/**
 * Arms the turn scheduler only if nothing is pending for the acting seat.
 * `armTurn` clears the room's timers before arming, so calling it on every
 * rejoin would hand the acting seat a fresh AFK window each time — a player
 * could hold the table open indefinitely by rejoining in a loop.
 *
 * A table with no pending timer is armed unconditionally: that is what a game
 * rehydrated after a restart needs, since nothing else would ever arm one.
 */
export function armTurnIfIdle(io: SocketServer, roomId: string) {
  const game = activeGames.get(roomId);
  if (!game) return;

  if (botTimers.has(roomId)) return emitTurnDeadline(io, roomId, game);
  const seatUserId = game.playerMap[actingSeat(game.gameState)];
  if (seatUserId !== undefined && afkTimers.has(`${roomId}:${seatUserId}`)) {
    return emitTurnDeadline(io, roomId, game);
  }

  armTurn(io, roomId);
}

function runBotTurn(io: SocketServer, roomId: string) {
  const game = activeGames.get(roomId);
  if (!game || game.gameState.roundOver) return;

  const seat = actingSeat(game.gameState);
  if (game.playerMap[seat] !== undefined) {
    // The seat was reclaimed while the timer was pending.
    armTurn(io, roomId);
    return;
  }

  // The takeover plays the round it happened on at minimum legal strength
  // (docs/GAME-RULES.md § Decisions) — the same "an AFK human should not be played well"
  // rule the turn timer already applies, kept until `dealRound` clears
  // `weakSeats` at the next deal, by which point the seat is honestly a bot's.
  const useBot = !game.weakSeats.has(seat);
  const auto = autoMoveForSeat(game, seat, useBot);
  if (!auto) {
    logger.error({ roomId, seat }, "Vacant seat could not act — closing table");
    io.to(roomId).emit("game:notification", {
      type: "abandoned",
      ...payload("GAME_INTERRUPTED_EMPTY_SEAT"),
    });
    void roomStore
      .updateRoomStatus(roomId, "finished")
      .catch((err) =>
        logger.warn(
          { err, roomId, seat },
          "Failed to set rooms.status = finished after closing a table with an unplayable empty seat"
        )
      );
    disposeGame(roomId);
    return;
  }

  void commitMove(io, game, auto.next, auto.move);
}

/** What the seat was made to do, or null when nothing was played. */
function handleAutoPass(
  io: SocketServer,
  roomId: string,
  userId: string
): "exchange" | "move" | null {
  const game = activeGames.get(roomId);
  if (!game || game.gameState.roundOver) return null;

  const seat = actingSeat(game.gameState);
  if (game.playerMap[seat] !== userId) return null;

  const wasExchange = !!game.gameState.exchangePhase?.active;
  const auto = autoMoveForSeat(game, seat, false);
  if (!auto) return null;

  void commitMove(io, game, auto.next, auto.move);
  return wasExchange ? "exchange" : "move";
}

function startAfkTimer(
  io: SocketServer,
  roomId: string,
  userId: string,
  username: string,
  timeoutMs: number
) {
  clearAfkTimer(roomId, userId);
  const key = `${roomId}:${userId}`;
  afkTimers.set(
    key,
    setTimeout(() => {
      afkTimers.delete(key);
      safeTimer(io, "afkAutoPass", roomId, () => {
        const acted = handleAutoPass(io, roomId, userId);
        // Only announce when something actually happened, not on an early
        // return that did nothing.
        if (acted) {
          const exchanged = acted === "exchange";
          io.to(roomId).emit("game:notification", {
            type: "afk",
            code: exchanged ? "PLAYER_AFK_AUTO_EXCHANGE" : "PLAYER_AFK_AUTO_PASS",
            message: exchanged
              ? `${username} is inactive — the card was exchanged automatically`
              : `${username} is inactive — passed automatically`,
            params: { username },
          });
        }
      });
    }, timeoutMs)
  );
}

// ─── Seat vacancy ─────────────────────────────────────────────────────────────

/**
 * Ends a round nobody is left to play: `winnerSeat` takes it, and every seat
 * still holding cards is placed behind them — closest to finishing first, seat
 * order as a stable tiebreak.
 *
 * Every seat must reach `finishingOrder` — the scoreboard awards from it and the
 * stats writer reads it. Seats that already emptied their hand keep the
 * position they earned.
 */
function concedeRound(game: OnlineGameState, winnerSeat: number | undefined) {
  const state = game.gameState;
  const place = (seat: number) => {
    const player = state.players[seat];
    if (!player || player.finishPosition !== undefined) return;
    player.finishPosition = state.finishingOrder.length + 1;
    state.finishingOrder.push(player.id);
  };

  if (winnerSeat !== undefined) place(winnerSeat);
  state.players
    .map((player, seat) => ({ player, seat }))
    .filter(({ player }) => player.finishPosition === undefined)
    .sort((a, b) => a.player.hand.length - b.player.hand.length || a.seat - b.seat)
    .forEach(({ seat }) => place(seat));

  state.roundOver = true;
}

/**
 * Frees a seat whose player is gone for good — grace period expired, or an
 * explicit leave, either mid-round or at the results screen — and hands it to a
 * bot. The round stays in play, so the table can always continue: the seat must
 * be removed from `playerMap` *and* marked bot-controlled together, or the table
 * deadlocks as soon as the turn comes round to it.
 */
export async function vacateSeat(
  io: SocketServer,
  roomId: string,
  userId: string,
  // Required rather than defaulting to `roundOverWriters`: the production
  // persist swallows its own failure, so a caller handed it by default writes
  // nothing a test can see.
  writers: RoundOverWriters
) {
  const game = activeGames.get(roomId);
  if (!game) return;

  game.rematchVotes.delete(userId);
  const seat = seatOfUser(game.playerMap, userId);
  if (seat === null) return;
  const username = seatName(game, seat);

  vacate(game, seat, { midHand: !game.gameState.roundOver });
  clearAfkTimer(roomId, userId);

  const remaining = Object.keys(game.playerMap).length;

  if (game.gameState.roundOver) {
    // Between rounds the table is not interrupted — it is waiting to deal
    // again — so the leaver simply stops counting towards the rematch vote.
    // This must NOT be `game:player_left`: that event drives the client's
    // "Match interrupted" teardown, which would eject everyone still sitting
    // at a table the server is about to restart.
    io.to(roomId).emit("game:seat_bot_takeover", {
      userId,
      username,
      seatIndex: seat,
      code: "PLAYER_LEFT_BOT_TAKEOVER",
      message: translate(DEFAULT_LOCALE, "server.PLAYER_LEFT_BOT_TAKEOVER", { username }),
      params: { username },
    });
    emitVoteState(io, roomId, game);
    if (remaining === 0) {
      await roomStore
        .updateRoomStatus(roomId, "finished")
        .catch((err) =>
          logger.warn(
            { err, roomId, userId, seat },
            "Failed to set rooms.status = finished after the last player left between rounds"
          )
        );
      disposeGame(roomId);
      return;
    }
    // The same write the mid-round tail makes. Nothing above this branch records an abandonment
    // a round there is none of, but `releasedSeats` and `vacatedSeats` were both
    // written, and a seat vacated between rounds is as reclaimable as one vacated
    // during one (docs/GAME-RULES.md § Decisions).
    writers.persistGameState(roomId, game);
    return;
  }

  if (remaining <= 1) {
    // Genuinely unplayable: no live player left to continue against.
    io.to(roomId).emit("game:player_left", { userId, username, seatIndex: seat });
    io.to(roomId).emit("game:notification", {
      type: "abandoned",
      code: "PLAYER_LEFT_ABANDONED",
      message: translate(DEFAULT_LOCALE, "server.PLAYER_LEFT_ABANDONED", { username }),
      params: { username },
    });

    if (game.roundsPlayed === 0) {
      // Nothing has been earned yet — no completed round behind this match —
      // so nothing is taken away: voided and rated for nobody, the walkout
      // included (docs/GAME-RULES.md § Decisions). A conceded round's forced placements
      // are not a genuine finish, so scoring them as the match's own first
      // round would defeat the point of the rule.
      await voidAbandonedMatch(io, roomId, game, writers);
      disposeGame(roomId);
      return;
    }

    // The round is scored rather than discarded. The win goes to the last seat
    // still held by a person; concedeRound places every seat still holding
    // cards behind them, the walkout included as the last-place finish a
    // abandonment is. `survivorSeat` is undefined when the departing seat was the
    // only human — the remaining bots then place among themselves, and
    // isContestedTable drops every write for such a table anyway.
    const survivorSeat = Object.keys(game.playerMap).map(Number)[0];
    concedeRound(game, survivorSeat);
    // Sets rooms.status = "finished" and writes the row itself; the write is
    // awaited so the disposal below deletes a row that already exists.
    await handleRoundOver(io, roomId, game, writers);
    disposeGame(roomId);
    return;
  }

  // The table survives with a bot in this seat — everyone else keeps
  // playing. This must NOT be `game:player_left`: that event drives the
  // client's "Match interrupted" teardown, which would eject every
  // remaining human from a game the server is still keeping alive.
  io.to(roomId).emit("game:seat_bot_takeover", {
    userId,
    username,
    seatIndex: seat,
    code: "PLAYER_LEFT_BOT_TAKEOVER",
    message: translate(DEFAULT_LOCALE, "server.PLAYER_LEFT_BOT_TAKEOVER", { username }),
    params: { username },
  });

  broadcastGameState(io, game);
  writers.persistGameState(roomId, game);
  armTurn(io, roomId);
}
