import type { TableRuntime } from "./tableRuntime.ts";
import { OK, refuse, type Outcome, type Refusal } from "../shared/refusal.ts";
import { logger } from "../shared/logger.ts";
import { trackEvent } from "../shared/events.ts";
import type { OnlineGameState } from "./gameRoom.ts";
import { publishState } from "./gamePersistence.ts";
import { handleRoundOver } from "./roundOver.ts";
import { armAfterMove } from "./gameTurn.ts";
import { appendReplayMove } from "./replayShape.ts";
import { seatOfUser } from "./onlineGameLogic.ts";
import { applyMove } from "../../lib/game/gameEngine.ts";
import { isStaleTurn } from "../../lib/game/moves.ts";
import type { MoveRefusal, SelectionRefusal } from "../../lib/game/gameEngine.ts";
import type { AutoMove } from "../../lib/game/autoMove.ts";
import type { TableAction } from "./tableActions.ts";

/** The client words a refused selection from the engine's code (`gameErrorText`); the server never does. */
const refusedSelection = (refusal: SelectionRefusal) => refuse("INVALID_MOVE", { refusal });

/** A refusal with no notice is silent: the ack alone answers it. */
const MOVE_REFUSAL_CODES = {
  roundOver: () => ({ ok: false, code: "NO_LIVE_GAME" }),
  exchangeOpen: () => refuse("EXCHANGE_PENDING"),
  noExchange: () => ({ ok: false, code: "NO_EXCHANGE" }),
  notExchangeWinner: () => ({ ok: false, code: "NOT_YOUR_EXCHANGE" }),
  notYourTurn: () => ({ ok: false, code: "NOT_YOUR_TURN" }),
  notHeld: () => refuse("INVALID_CARD"),
  notACombination: () => refusedSelection("notACombination"),
  needsStartCard: () => refusedSelection("needsStartCard"),
  royalUnbeatable: () => refusedSelection("royalUnbeatable"),
  bombOnly: () => refusedSelection("bombOnly"),
  wrongType: () => refusedSelection("wrongType"),
  wrongLength: () => refusedSelection("wrongLength"),
  tooLow: () => refusedSelection("tooLow"),
  mustLead: () => refuse("CANNOT_PASS"),
  notGiveable: () => refuse("INVALID_CARD"),
} satisfies Record<MoveRefusal, () => Refusal>;

export function moveAction(
  rt: TableRuntime,
  game: OnlineGameState,
  action: Extract<TableAction, { kind: "move" }>
): Promise<Outcome> | Outcome {
  const { roomId, userId, move } = action;
  const prev = game.gameState;
  // Before the engine, not after: a retry of a pass that already landed is a legal pass again once the turn comes back.
  if (isStaleTurn(prev, action.turn)) return MOVE_REFUSAL_CODES.notYourTurn();
  const seat = seatOfUser(game.playerMap, userId) ?? -1;
  const result = applyMove(prev, seat, move);
  if (!result.ok) {
    // A seat on move with no player behind it in the state is a table that is not live, not a card refused.
    if (result.code === "notHeld" && !prev.players[seat]) return { ok: false, code: "NO_LIVE_GAME" };
    return MOVE_REFUSAL_CODES[result.code]();
  }

  if (result.move.kind === "play") {
    // A count and a type, never card identities: enabling debug in production
    // must not be able to expose a hand.
    const { seat, combo } = result.move;
    logger.debug({ roomId, seat, comboType: combo.type, cardCount: combo.cards.length }, "Play accepted");
  }
  if (prev.openingCard !== null && result.state.openingCard === null) {
    trackEvent("game.firstMoveMade", userId, {
      playerCount: result.state.players.length,
      gameMode: result.state.gameMode,
    });
  }

  return commitMove(rt, game, result)?.then(() => OK) ?? OK;
}

/**
 * The one way a move lands on a live table, whoever chose it: flagged and logged
 * for the replay, sent, persisted, then the next seat armed — or, when it ended
 * the round, the round-over handoff, whose promise is returned.
 *
 * The flags are the achievements' only record of a bomb or joker played this
 * round — the engine keeps none — so a forced move (most often an AFK-forced
 * lone joker) that skipped them would under-count purist / iron_will / wild_card.
 */
export function commitMove(rt: TableRuntime, game: OnlineGameState, applied: AutoMove): Promise<void> | undefined {
  const { state: next, move } = applied;
  const prev = game.gameState;
  if (move.kind === "play") {
    const flags = (game.roundFlags[move.seat] ??= { bomb: false, joker: false });
    if (move.combo.type === "bomb") flags.bomb = true;
    if (move.combo.cards.some((c) => c.isJoker)) flags.joker = true;
  }
  if (move.kind === "play" || move.kind === "pass") {
    appendReplayMove(game, move.seat, move.kind === "play" ? move.combo : null, prev, next);
  }
  game.gameState = next;
  void publishState(rt, game);
  if (next.roundOver) return handleRoundOver(rt, game.roomId, game);
  armAfterMove(rt, game.roomId, next);
}
