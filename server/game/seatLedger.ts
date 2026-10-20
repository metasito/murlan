import { seatName, type OnlineGameState } from "./gameRoom.ts";
import { scoreKeyForSeat } from "./onlineGameLogic.ts";
import { carrySeatScore } from "./matchLedger.ts";

/**
 * The only writer of a table's seat fields — `playerMap`, `vacatedSeats`,
 * `releasedSeats`, `abandonedSeats`, `weakSeats` and `endMatchVotes`, read-only
 * everywhere else (`tests/server/ledgerFields.types.test.ts`). It mutates state
 * and nothing else: emits, timers and persistence stay with the callers.
 */
interface SeatFields {
  playerMap: Record<number, string>;
  vacatedSeats: Map<number, { userId: string; username: string }>;
  releasedSeats: Set<string>;
  abandonedSeats: Map<number, string>;
  weakSeats: Set<number>;
  endMatchVotes: Set<string>;
}

function seats(game: OnlineGameState): SeatFields {
  return game as unknown as SeatFields;
}

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
  const ledger = seats(game);
  ledger.releasedSeats.add(userId);
  delete ledger.playerMap[seat];
  if (seatPlayer) seatPlayer.type = "bot";

  // Reclaimable by this account for the life of the match (docs/GAME-RULES.md
  // § Decisions), and where `seatTotal` finds the person's frozen total.
  ledger.vacatedSeats.set(seat, { userId, username: seatName(game, seat) });
  // A roster change makes "is the table still the one everyone joined" new again.
  ledger.endMatchVotes.clear();

  const abandoned = midHand && seatPlayer?.finishPosition === undefined;
  if (abandoned) {
    ledger.abandonedSeats.set(seat, userId);
    // Minimum-strength play is scoped to this round; `clearForDeal` ends it.
    ledger.weakSeats.add(seat);
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
  const ledger = seats(game);
  ledger.playerMap[seat] = userId;
  carrySeatScore(game, botKey, userId);
  ledger.vacatedSeats.delete(seat);
  ledger.releasedSeats.delete(userId);
  ledger.endMatchVotes.clear();
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
  const ledger = seats(game);
  ledger.abandonedSeats.clear();
  ledger.weakSeats.clear();
  ledger.endMatchVotes.clear();
}

export function castEndMatchVote(game: OnlineGameState, userId: string, wants: boolean): void {
  if (wants) seats(game).endMatchVotes.add(userId);
  else seats(game).endMatchVotes.delete(userId);
}
