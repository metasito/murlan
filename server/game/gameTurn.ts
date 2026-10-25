import type { TableRuntime } from "./tableRuntime.ts";
import { emitVoteState } from "./tableBroadcasts.ts";
import { logger } from "../shared/logger.ts";
import { activeGames, seatName } from "./gameRoom.ts";
import { seatOfUser, settledCeremonyMs } from "./onlineGameLogic.ts";
import { vacate } from "./seatLedger.ts";
import { withdrawRematchVote } from "./matchLedger.ts";
import { payload } from "../shared/payload.ts";
import { now } from "../http/clock.ts";
import type { OnlineGameState } from "./gameRoom.ts";
import {
  arm,
  pending,
  seatKey,
  afkTimeoutMs,
  botMoveDelayMs,
  clearAfkTimer,
  clearRoomTimers,
  secondsUntil,
} from "./gameTimers.ts";
import { closeTable, disposeGame, publishState, safeTimer } from "./gamePersistence.ts";
import { handleRoundOver, voidAbandonedMatch } from "./roundOver.ts";
import { commitMove } from "./tableMoves.ts";
import { autoMoveForSeat } from "../../lib/game/autoMove.ts";
import { actingSeat, concedeRound, roundUnplayed, openingIsPending } from "../../lib/game/gameEngine.ts";
import type { GameState } from "../../lib/game/gameEngine.ts";
import { Motion, Reading } from "../../lib/tokens.ts";
import { dealEndMs } from "../../lib/timeline/dealTimeline.ts";
import { exchangeGiveDelayMs, exchangeOneWayDelayMs } from "../../lib/timeline/exchangeTimeline.ts";
import { isOneWay } from "../../lib/game/sharedGameFlow.ts";
import { handCountOf } from "../../shared/protocol.ts";

/**
 * Tells the table how long the acting seat has left. Sent on its own as well
 * as with the state, because the AFK window is re-armed on paths that change
 * no state at all — every rejoin and every disconnect — and a clock that ran
 * to zero while the server still held a full window reads as a frozen table.
 */
function emitTurnDeadline(rt: TableRuntime, roomId: string, game: OnlineGameState) {
  rt.out.room(roomId).emit("game:turn_deadline", {
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
export function armTurn(rt: TableRuntime, roomId: string, botDelayMs = botMoveDelayMs()) {
  const game = activeGames.get(roomId);
  if (!game) return;

  // Ahead of the clear: a rejoin at the results screen reaches here through
  // `armTurnIfIdle`, and must not cancel the vote deadline the table is under.
  if (game.gameState.roundOver) {
    game.turnDeadlineMs = undefined;
    return;
  }
  clearRoomTimers(roomId);

  const seat = actingSeat(game.gameState);
  const userId = game.playerMap[seat];
  const counts = game.gameState.players.map(handCountOf);
  // The loser's first move waits for the pills to tell a one-way exchange, as the opener's does for two Jokers.
  const oneWayMs = isOneWay(game.gameState.exchangePhase) && roundUnplayed(game.gameState) ? exchangeOneWayDelayMs(counts) : 0;

  if (userId === undefined) {
    game.turnDeadlineMs = undefined;
    const phase = game.gameState.exchangePhase;
    const exchangeOnTable = phase?.kind === "open" || (phase?.kind === "twoJokers" && roundUnplayed(game.gameState));
    const waitMs = oneWayMs > 0
      ? oneWayMs
      : exchangeOnTable
        ? exchangeGiveDelayMs(counts)
        : roundUnplayed(game.gameState)
          ? dealEndMs(counts, Motion.duration.reveal)
          : 0;
    const delayMs = Math.max(botDelayMs, waitMs);
    arm("bot", roomId, delayMs, () => safeTimer(rt, "botTurn", roomId, () => runBotTurn(rt, roomId)));
    emitTurnDeadline(rt, roomId, game);
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
  const timeoutMs = afkTimeoutMs() + openingGraceMs + oneWayMs;
  game.turnDeadlineMs = now() + timeoutMs;
  startAfkTimer(rt, roomId, userId, username, timeoutMs);
  emitTurnDeadline(rt, roomId, game);
}

/** Every move re-arms here, so an exchange's ceremony holds the next seat on each path that closes it. */
export function armAfterMove(rt: TableRuntime, roomId: string, next: GameState) {
  const closedExchange = next.lastMove.kind === "giveback";
  armTurn(rt, roomId, closedExchange ? settledCeremonyMs() : botMoveDelayMs());
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
export function armTurnIfIdle(rt: TableRuntime, roomId: string) {
  const game = activeGames.get(roomId);
  if (!game) return;

  if (pending("bot", roomId)) return emitTurnDeadline(rt, roomId, game);
  const seatUserId = game.playerMap[actingSeat(game.gameState)];
  if (seatUserId !== undefined && pending("afk", seatKey(roomId, seatUserId))) {
    return emitTurnDeadline(rt, roomId, game);
  }

  armTurn(rt, roomId);
}

/** This process's tables only: a round another instance holds is not found. */
export function heldRoundFor(userId: string): { roomId: string; game: OnlineGameState } | null {
  for (const [roomId, game] of activeGames) {
    if (seatOfUser(game.playerMap, userId) !== null && !game.gameState.roundOver) return { roomId, game };
  }
  return null;
}

function runBotTurn(rt: TableRuntime, roomId: string) {
  const game = activeGames.get(roomId);
  if (!game || game.gameState.roundOver) return;

  const seat = actingSeat(game.gameState);
  if (game.playerMap[seat] !== undefined) {
    // The seat was reclaimed while the timer was pending.
    armTurn(rt, roomId);
    return;
  }

  // The takeover plays the round it happened on at minimum legal strength
  // (docs/GAME-RULES.md § Decisions) — the same "an AFK human should not be played well"
  // rule the turn timer already applies, kept until `dealRound` clears
  // `weakSeats` at the next deal, by which point the seat is honestly a bot's.
  const auto = autoMoveForSeat(game.gameState, seat, game.weakSeats.has(seat) ? "floor" : "bot");
  if (!auto) {
    logger.error({ roomId, seat }, "Vacant seat could not act — closing table");
    closeTable(rt, roomId, "GAME_INTERRUPTED_EMPTY_SEAT");
    return;
  }

  void commitMove(rt, game, auto);
}

/** What the seat was made to do, or null when nothing was played. */
function handleAutoPass(
  rt: TableRuntime,
  roomId: string,
  userId: string
): "exchange" | "move" | null {
  const game = activeGames.get(roomId);
  if (!game || game.gameState.roundOver) return null;

  const seat = actingSeat(game.gameState);
  if (game.playerMap[seat] !== userId) return null;

  const auto = autoMoveForSeat(game.gameState, seat, "floor");
  if (!auto) return null;

  void commitMove(rt, game, auto);
  return auto.move.kind === "play" || auto.move.kind === "pass" ? "move" : "exchange";
}

function startAfkTimer(
  rt: TableRuntime,
  roomId: string,
  userId: string,
  username: string,
  timeoutMs: number
) {
  arm("afk", seatKey(roomId, userId), timeoutMs, () => {
    safeTimer(rt, "afkAutoPass", roomId, () => {
      const acted = handleAutoPass(rt, roomId, userId);
      // Only announce when something actually happened, not on an early
      // return that did nothing.
      if (acted) {
        const exchanged = acted === "exchange";
        rt.out.room(roomId).emit("game:notification", {
          type: "afk",
          ...payload(exchanged ? "PLAYER_AFK_AUTO_EXCHANGE" : "PLAYER_AFK_AUTO_PASS", { username }),
        });
      }
    });
  });
}

// ─── Seat vacancy ─────────────────────────────────────────────────────────────

/**
 * Frees a seat whose player is gone for good — grace period expired, or an
 * explicit leave, either mid-round or at the results screen — and hands it to a
 * bot. The round stays in play, so the table can always continue: the seat must
 * be removed from `playerMap` *and* marked bot-controlled together, or the table
 * deadlocks as soon as the turn comes round to it.
 */
export async function vacateSeat(rt: TableRuntime, roomId: string, userId: string) {
  const game = activeGames.get(roomId);
  if (!game) return;

  withdrawRematchVote(game, userId);
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
    rt.out.room(roomId).emit("game:seat_bot_takeover", {
      userId,
      username,
      seatIndex: seat,
      ...payload("PLAYER_LEFT_BOT_TAKEOVER", { username }),
    });
    emitVoteState(rt.out.room(roomId), game);
    // `seat_bot_takeover` above already told the table.
    if (remaining === 0) return closeTable(rt, roomId, null);
    // The same write the mid-round tail makes. Nothing above this branch records an abandonment
    // a round there is none of, but `releasedSeats` and `vacatedSeats` were both
    // written, and a seat vacated between rounds is as reclaimable as one vacated
    // during one (docs/GAME-RULES.md § Decisions).
    void rt.writers.persistGameState(roomId, game);
    return;
  }

  if (remaining <= 1) {
    // Genuinely unplayable: no live player left to continue against.
    rt.out.room(roomId).emit("game:player_left", { userId, username, seatIndex: seat });
    rt.out.room(roomId).emit("game:notification", {
      type: "abandoned",
      ...payload("PLAYER_LEFT_ABANDONED", { username }),
    });

    if (game.roundsPlayed === 0) {
      // Nothing has been earned yet — no completed round behind this match —
      // so nothing is taken away: voided and rated for nobody, the walkout
      // included (docs/GAME-RULES.md § Decisions). A conceded round's forced placements
      // are not a genuine finish, so scoring them as the match's own first
      // round would defeat the point of the rule.
      await voidAbandonedMatch(rt, roomId, game);
      disposeGame(rt, roomId);
      return;
    }

    // The round is scored rather than discarded. The win goes to the last seat
    // still held by a person; concedeRound places every seat still holding
    // cards behind them, the walkout included as the last-place finish a
    // abandonment is. `survivorSeat` is undefined when the departing seat was the
    // only human — the remaining bots then place among themselves, and
    // isContestedTable drops every write for such a table anyway.
    const survivorSeat = Object.keys(game.playerMap).map(Number)[0];
    game.gameState = concedeRound(game.gameState, survivorSeat);
    // Sets rooms.status = "finished" and writes the row itself; the write is
    // awaited so the disposal below deletes a row that already exists.
    await handleRoundOver(rt, roomId, game);
    disposeGame(rt, roomId);
    return;
  }

  // The table survives with a bot in this seat — everyone else keeps
  // playing. This must NOT be `game:player_left`: that event drives the
  // client's "Match interrupted" teardown, which would eject every
  // remaining human from a game the server is still keeping alive.
  rt.out.room(roomId).emit("game:seat_bot_takeover", {
    userId,
    username,
    seatIndex: seat,
    ...payload("PLAYER_LEFT_BOT_TAKEOVER", { username }),
  });

  void publishState(rt, game);
  armTurn(rt, roomId);
}
