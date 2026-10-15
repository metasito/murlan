import { seatName, type OnlineGameState } from "./gameRoom.ts";
import { scoreKeyForSeat } from "./onlineGameLogic.ts";

/**
 * The only writer of a table's seat fields — `playerMap`, `vacatedSeats`,
 * `releasedSeats`, `abandonedSeats`, `weakSeats` and `endMatchVotes`
 * (`tests/server/seatLedger.test.ts` scans for any other). It mutates state and
 * nothing else: emits, timers and persistence stay with the callers.
 */

/**
 * Hands a seat whose player is gone for good to a bot. `midHand` is whether a
 * round is in play; walking out on one while still holding cards is an abandonment.
 */
export function vacate(
  game: OnlineGameState,
  seat: number,
  { midHand }: { midHand: boolean }
): { abandoned: boolean } {
  const userId = game.playerMap[seat];
  if (userId === undefined) return { abandoned: false };
  const seatPlayer = game.gameState.players[seat];

  // Out of `playerMap` and bot-controlled together, or the table deadlocks as
  // soon as the turn comes round to the seat.
  game.releasedSeats.add(userId);
  delete game.playerMap[seat];
  if (seatPlayer) seatPlayer.type = "bot";

  // Reclaimable by this account for the life of the match (docs/GAME-RULES.md
  // § Decisions), and where `seatTotal` finds the person's frozen total.
  game.vacatedSeats.set(seat, { userId, username: seatName(game, seat) });
  // A roster change makes "is the table still the one everyone joined" new again.
  game.endMatchVotes.clear();

  const abandoned = midHand && seatPlayer?.finishPosition === undefined;
  if (abandoned) {
    game.abandonedSeats.set(seat, userId);
    // Minimum-strength play is scoped to this round; `clearForDeal` ends it.
    game.weakSeats.add(seat);
  }
  return { abandoned };
}

/**
 * Gives `userId` back the seat they vacated this match, carrying the points
 * the bot scored there onto their own key. Null when they vacated none.
 * `vacatedSeats` is the whole of the decision, so a match `endMatchByAgreement`
 * closed still hands the seat back while the table sits at its results screen.
 */
export function reclaim(game: OnlineGameState, userId: string): number | null {
  const seat = [...game.vacatedSeats].find(([, vacated]) => vacated.userId === userId)?.[0];
  if (seat === undefined) return null;

  // Read before `playerMap` names the seat again, which changes its key.
  const botKey = scoreKeyForSeat(game.playerMap, seat);
  game.playerMap[seat] = userId;
  const carried = game.cumulativeScores[botKey] ?? 0;
  if (carried !== 0) {
    game.cumulativeScores[userId] = (game.cumulativeScores[userId] ?? 0) + carried;
  }
  delete game.cumulativeScores[botKey];
  game.vacatedSeats.delete(seat);
  game.releasedSeats.delete(userId);
  game.endMatchVotes.clear();
  const seatPlayer = game.gameState.players[seat];
  if (seatPlayer) seatPlayer.type = "human";
  return seat;
}

/**
 * What a fresh deal ends: the last round's abandonments, its weak bots and any
 * end-match tally. Vacancies outlive the deal — a seat stays reclaimable until
 * the match ends.
 */
export function clearForDeal(game: OnlineGameState): void {
  game.abandonedSeats.clear();
  game.weakSeats.clear();
  game.endMatchVotes.clear();
}

export function castEndMatchVote(game: OnlineGameState, userId: string, wants: boolean): void {
  if (wants) game.endMatchVotes.add(userId);
  else game.endMatchVotes.delete(userId);
}
