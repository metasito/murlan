import type { Server as SocketServer } from "socket.io";
import { storage } from "./storage.ts";
import { logger } from "./logger.ts";
import { activeGames, seatOfUser } from "./gameRoom.ts";
import type { OnlineGameState } from "./gameRoom.ts";
import {
  afkTimers,
  botTimers,
  AFK_TIMEOUT_MS,
  BOT_MOVE_DELAY_MS,
  clearAfkTimer,
  clearRoomTimers,
  secondsUntil,
} from "./gameTimers.ts";
import {
  broadcastGameState,
  disposeGame,
  gameOverWriters,
  persistGameState,
  safeTimer,
} from "./gamePersistence.ts";
import { handleGameOver } from "./gameOver.ts";
import { appendReplayMove } from "./replayShape.ts";
import {
  processPlay,
  processPass,
  processExchangeChoice,
  buildCombination,
  sortHand,
  aiChoosePlay,
  getValidGivebackCards,
  getStartingPlayerAfterExchange,
  deepCloneState,
} from "../lib/gameEngine.ts";
import type { GameState, Combination } from "../lib/gameEngine.ts";

/** The seat that must act right now: the exchange winner, or the turn holder. */
function actingSeat(state: GameState): number {
  return state.exchangePhase?.active
    ? state.exchangePhase.winnerIdx
    : state.currentTurnIndex;
}

/**
 * Safety valve: the exchange winner holds no card they are allowed to give
 * back. Nobody — human or bot — can satisfy the phase, so it is closed and the
 * hand continues. Without this the whole table sits behind the exchange
 * overlay forever.
 */
function resolveStuckExchange(state: GameState): GameState {
  const next = deepCloneState(state);
  if (next.exchangePhase) next.exchangePhase.active = false;
  next.currentTurnIndex = getStartingPlayerAfterExchange(state);
  next.lastPlayedBy = next.currentTurnIndex;
  return next;
}

/**
 * Achievement bookkeeping: the engine has no notion of "did this
 * seat play a bomb/joker this hand", so every path that actually plays a
 * combination — the human game:play handler and this module's own
 * bot/AFK-forced auto-play — has to update it here, or a forced move (most
 * commonly an AFK-forced lone joker) silently under-counts the purist /
 * iron_will / wild_card achievements.
 */
export function recordPlayFlags(game: AutoMovable, seat: number, combo: Combination) {
  const flags = (game.handFlags[seat] ??= { bomb: false, joker: false });
  if (combo.type === "bomb") flags.bomb = true;
  if (combo.cards.some((c) => c.isJoker)) flags.joker = true;
}

export type AutoMovable = Pick<OnlineGameState, "gameState" | "handFlags" | "moveLog">;

/**
 * One automated action for a seat.
 *
 * `useAi` picks the real engine AI (a seat abandoned by its player), otherwise
 * the minimum legal move (an AFK human, who should not be played well on their
 * behalf). Returns the new state, or null when the seat cannot act at all.
 */
export function autoMoveForSeat(
  game: AutoMovable,
  seat: number,
  useAi: boolean
): GameState | null {
  const state = game.gameState;

  if (state.exchangePhase?.active) {
    if (state.exchangePhase.winnerIdx !== seat) return null;
    const player = state.players[seat];
    if (!player) return null;
    const valid = getValidGivebackCards(player.hand, state.exchangePhase.cardFromLoser?.id);
    if (valid.length === 0) return resolveStuckExchange(state);
    return processExchangeChoice(state, valid[0].id);
  }

  if (state.currentTurnIndex !== seat) return null;
  const player = state.players[seat];
  if (!player || player.hand.length === 0) return null;

  const isNewRound = state.lastPlayedCombination === null;
  // The start card is only mandatory for the very first play of the hand.
  const requireCard = !state.firstPlayMade ? state.startCard : undefined;

  /** Records the move for the replay log and hands back the state it produced. */
  const logged = (combo: Combination | null, next: GameState): GameState => {
    appendReplayMove(game, seat, combo, next);
    return next;
  };

  if (useAi) {
    const otherCounts = state.players
      .filter((_, i) => i !== seat)
      .map((p) => p.hand.length);
    const combo = aiChoosePlay(
      player,
      isNewRound ? null : state.lastPlayedCombination,
      isNewRound,
      otherCounts.length > 0 ? otherCounts : [0],
      requireCard
    );
    if (combo) {
      recordPlayFlags(game, seat, combo);
      return logged(combo, processPlay(state, combo));
    }
    if (!isNewRound) return logged(null, processPass(state));
    // A new round cannot be passed — fall through to the forced minimum play.
  }

  if (isNewRound) {
    // Read the mandatory opening card from the state instead of assuming 3♠:
    // with the full deal it is always present, but it is not always a spade 3.
    const forced = requireCard
      ? player.hand.find((c) => c.id === requireCard.id)
      : undefined;
    const card = forced ?? sortHand([...player.hand])[0];
    if (!card) return null;
    const combo = buildCombination([card]);
    if (!combo) return null;
    recordPlayFlags(game, seat, combo);
    return logged(combo, processPlay(state, combo));
  }

  return logged(null, processPass(state));
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
 */
export function armTurn(io: SocketServer, roomId: string) {
  const game = activeGames.get(roomId);
  if (!game) return;

  clearRoomTimers(roomId);
  if (game.gameState.gameOver) {
    game.turnDeadlineMs = undefined;
    return;
  }

  const seat = actingSeat(game.gameState);
  const userId = game.playerMap[seat];

  if (userId === undefined) {
    game.turnDeadlineMs = undefined;
    botTimers.set(
      roomId,
      setTimeout(() => {
        botTimers.delete(roomId);
        safeTimer(io, "botTurn", roomId, () => runBotTurn(io, roomId));
      }, BOT_MOVE_DELAY_MS)
    );
    emitTurnDeadline(io, roomId, game);
    return;
  }

  const username = game.gameState.players[seat]?.name ?? "";
  game.turnDeadlineMs = Date.now() + AFK_TIMEOUT_MS;
  startAfkTimer(io, roomId, userId, username);
  emitTurnDeadline(io, roomId, game);
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
  if (!game || game.gameState.gameOver) return;

  const seat = actingSeat(game.gameState);
  if (game.playerMap[seat] !== undefined) {
    // The seat was reclaimed while the timer was pending.
    armTurn(io, roomId);
    return;
  }

  const next = autoMoveForSeat(game, seat, true);
  if (!next) {
    logger.error({ roomId, seat }, "Vacant seat could not act — closing table");
    io.to(roomId).emit("game:notification", {
      type: "abandoned",
      code: "GAME_INTERRUPTED_EMPTY_SEAT",
      message: "Match interrupted: an empty seat cannot play.",
    });
    void storage
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

  game.gameState = next;
  broadcastGameState(io, game);
  persistGameState(roomId, game);

  if (next.gameOver) {
    void handleGameOver(io, roomId, game, gameOverWriters);
  } else {
    armTurn(io, roomId);
  }
}

/** What the seat was made to do, or null when nothing was played. */
function handleAutoPass(
  io: SocketServer,
  roomId: string,
  userId: string
): "exchange" | "move" | null {
  const game = activeGames.get(roomId);
  if (!game || game.gameState.gameOver) return null;

  const seat = actingSeat(game.gameState);
  if (game.playerMap[seat] !== userId) return null;

  const wasExchange = !!game.gameState.exchangePhase?.active;
  const next = autoMoveForSeat(game, seat, false);
  if (!next) return null;

  game.gameState = next;
  broadcastGameState(io, game);
  persistGameState(roomId, game);

  if (next.gameOver) {
    void handleGameOver(io, roomId, game, gameOverWriters);
  } else {
    armTurn(io, roomId);
  }
  return wasExchange ? "exchange" : "move";
}

function startAfkTimer(
  io: SocketServer,
  roomId: string,
  userId: string,
  username: string
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
              ? `${username} è inattivo — carta scambiata automaticamente`
              : `${username} è inattivo — passato automaticamente`,
            params: { username },
          });
        }
      });
    }, AFK_TIMEOUT_MS)
  );
}

// ─── Seat vacancy ─────────────────────────────────────────────────────────────

/**
 * Ends a hand nobody is left to play: `winnerSeat` takes it, and every seat
 * still holding cards is placed behind them — closest to finishing first, seat
 * order as a stable tiebreak, the same ordering the engine uses when a hand
 * ends with cards still out.
 *
 * Every seat must reach `rankings` — the scoreboard awards from it and the
 * stats writer reads it. Seats that already emptied their hand keep the
 * position they earned.
 */
function concedeHand(game: OnlineGameState, winnerSeat: number | undefined) {
  const state = game.gameState;
  const place = (seat: number) => {
    const player = state.players[seat];
    if (!player || player.finishPosition !== undefined) return;
    player.finishPosition = state.rankings.length + 1;
    state.rankings.push(player.id);
  };

  if (winnerSeat !== undefined) place(winnerSeat);
  state.players
    .map((player, seat) => ({ player, seat }))
    .filter(({ player }) => player.finishPosition === undefined)
    .sort((a, b) => a.player.hand.length - b.player.hand.length || a.seat - b.seat)
    .forEach(({ seat }) => place(seat));

  state.gameOver = true;
}

/**
 * Frees a seat whose player is gone for good — grace period expired, or an
 * explicit leave, either mid-hand or at the results screen — and hands it to a
 * bot. The hand stays in play, so the table can always continue: the seat must
 * be removed from `playerMap` *and* marked AI-controlled together, or the table
 * deadlocks as soon as the turn comes round to it.
 */
export async function vacateSeat(
  io: SocketServer,
  roomId: string,
  userId: string,
  username: string
) {
  const game = activeGames.get(roomId);
  if (!game) return;

  game.rematchVotes.delete(userId);
  const seat = seatOfUser(game, userId);
  if (seat === null) return;

  delete game.playerMap[seat];
  clearAfkTimer(roomId, userId);

  const seatPlayer = game.gameState.players[seat];
  if (seatPlayer) seatPlayer.type = "ai";

  // Walking out on a hand still holding cards is a forfeit, and is recorded as
  // one at game over. A seat between hands has no hand to forfeit, and a seat
  // that already emptied its hand has finished the one it was playing.
  if (!game.gameState.gameOver && seatPlayer?.finishPosition === undefined) {
    game.abandonedSeats.set(seat, userId);
  }

  const remaining = Object.keys(game.playerMap).length;

  if (game.gameState.gameOver) {
    // Between hands the table is not interrupted — it is waiting to deal
    // again — so the leaver simply stops counting towards the rematch vote.
    // This must NOT be `game:player_left`: that event drives the client's
    // "Partita interrotta" teardown, which would eject everyone still sitting
    // at a table the server is about to restart.
    io.to(roomId).emit("game:seat_bot_takeover", {
      userId,
      username,
      seatIndex: seat,
      code: "PLAYER_LEFT_BOT_TAKEOVER",
      message: `${username} ha lasciato la partita — il computer gioca al suo posto.`,
      params: { username },
    });
    // `total` is the seated-seat count, which is what the `game:rematch_vote`
    // gate compares `rematchVotes.size` against.
    io.to(roomId).emit("game:vote_state", {
      votes: Array.from(game.rematchVotes),
      total: remaining,
    });
    if (remaining === 0) {
      await storage
        .updateRoomStatus(roomId, "finished")
        .catch((err) =>
          logger.warn(
            { err, roomId, userId, seat },
            "Failed to set rooms.status = finished after the last player left between hands"
          )
        );
      disposeGame(roomId);
    }
    return;
  }

  if (remaining <= 1) {
    // Genuinely unplayable: no live player left to continue against.
    io.to(roomId).emit("game:player_left", { userId, username, seatIndex: seat });
    io.to(roomId).emit("game:notification", {
      type: "abandoned",
      code: "PLAYER_LEFT_ABANDONED",
      message: `${username} ha lasciato la partita.`,
      params: { username },
    });
    // The hand is scored rather than discarded. The win goes to the last seat
    // still held by a person; concedeHand places every seat still holding
    // cards behind them, the walkout included as the last-place finish a
    // forfeit is. `survivorSeat` is undefined when the departing seat was the
    // only human — the remaining bots then place among themselves, and
    // isContestedTable drops every write for such a table anyway.
    const survivorSeat = Object.keys(game.playerMap).map(Number)[0];
    concedeHand(game, survivorSeat);
    // Sets rooms.status = "finished" and writes the row itself; the write is
    // awaited so the disposal below deletes a row that already exists.
    await handleGameOver(io, roomId, game, gameOverWriters);
    disposeGame(roomId);
    return;
  }

  // The table survives with a bot in this seat — everyone else keeps
  // playing. This must NOT be `game:player_left`: that event drives the
  // client's "Partita interrotta" teardown, which would eject every
  // remaining human from a game the server is still keeping alive.
  io.to(roomId).emit("game:seat_bot_takeover", {
    userId,
    username,
    seatIndex: seat,
    code: "PLAYER_LEFT_BOT_TAKEOVER",
    message: `${username} ha lasciato la partita — il computer gioca al suo posto.`,
    params: { username },
  });

  broadcastGameState(io, game);
  persistGameState(roomId, game);
  armTurn(io, roomId);
}
