// server/seatAllocation.ts — which seat a player gets, and which seats are
// being held for someone who has not arrived yet.
//
// Clockless on purpose: the caller passes `now` and the hold's length, so the
// expiry is arithmetic a test can drive rather than a timer it has to outlast.
import { teamForSeat } from "../lib/gameEngine.ts";
import type { GameMode } from "../lib/gameEngine.ts";

export interface SeatedPlayer {
  userId: string;
  seatIndex: number;
}

/**
 * An invite, as the reservation reads it. `createdAt` is refreshed by
 * `recordGameInvite` on a re-invite, so the hold restarts with the asking.
 */
export interface SeatInvite {
  inviterId: string;
  inviteeId: string;
  createdAt: Date | null;
}

export interface SeatingRoom {
  maxPlayers: number;
  gameMode: GameMode | string;
}

export interface SeatingInput {
  room: SeatingRoom;
  seated: readonly SeatedPlayer[];
  invites: readonly SeatInvite[];
  now: number;
  holdMs: number;
}

/** A seat being held, and when the hold lapses. */
export interface SeatHold {
  seatIndex: number;
  inviteeId: string;
  expiresAt: number;
}

function teamOfSeat(room: SeatingRoom, seatIndex: number) {
  return teamForSeat(seatIndex, room.maxPlayers, room.gameMode as GameMode);
}

/**
 * The free seat a newcomer belongs in: the one on `preferTeam` if it is asked
 * for and available, otherwise the one whose team has fewer players.
 *
 * Lowest-free-index is what put two friends who quick-matched into the same
 * teams room on opposite sides, because seat 0 and seat 1 are opposite sides.
 */
function bestFreeSeat(
  room: SeatingRoom,
  seated: readonly SeatedPlayer[],
  blocked: ReadonlySet<number>,
  preferTeam: "A" | "B" | undefined
): number | null {
  const free: number[] = [];
  for (let seat = 0; seat < room.maxPlayers; seat++) {
    if (!blocked.has(seat)) free.push(seat);
  }
  const first = free[0];
  if (first === undefined) return null;

  if (preferTeam !== undefined) {
    const onSide = free.find((seat) => teamOfSeat(room, seat) === preferTeam);
    if (onSide !== undefined) return onSide;
  }

  const sideSize = (team: "A" | "B" | undefined) =>
    team === undefined
      ? 0
      : seated.filter((p) => teamOfSeat(room, p.seatIndex) === team).length;

  let best = first;
  for (const seat of free) {
    const team = teamOfSeat(room, seat);
    const bestTeam = teamOfSeat(room, best);
    if (team === undefined || bestTeam === undefined || team === bestTeam) continue;
    if (sideSize(team) < sideSize(bestTeam)) best = seat;
  }
  return best;
}

function liveInvites(input: SeatingInput): { invite: SeatInvite; expiresAt: number }[] {
  return input.invites
    .flatMap((invite) => {
      const createdAt = invite.createdAt?.getTime();
      if (createdAt === undefined) return [];
      return [{ invite, expiresAt: createdAt + input.holdMs }];
    })
    .filter(({ expiresAt }) => expiresAt > input.now)
    .sort((a, b) => a.expiresAt - b.expiresAt);
}

/**
 * The seats held for people who have been invited and have not arrived.
 *
 * An invitee is held the seat on their inviter's own side, which is the whole
 * point of the hold: you invite a friend, and the seat that waits for them is
 * the one that makes them your partner.
 */
export function heldSeats(input: SeatingInput): SeatHold[] {
  // A room with no sides has no side to hold you a seat on, and a hold there
  // would only cost a free-for-all lobby a seat for two minutes. The three
  // cases this exists for are all 2-v-2 (docs/BRIEF.md §3.3).
  if (teamOfSeat(input.room, 0) === undefined) return [];

  const held: SeatHold[] = [];
  const blocked = new Set(input.seated.map((p) => p.seatIndex));

  for (const { invite, expiresAt } of liveInvites(input)) {
    if (input.seated.some((p) => p.userId === invite.inviteeId)) continue;
    if (held.some((h) => h.inviteeId === invite.inviteeId)) continue;
    const inviter = input.seated.find((p) => p.userId === invite.inviterId);
    const seatIndex = bestFreeSeat(
      input.room,
      input.seated,
      blocked,
      inviter ? teamOfSeat(input.room, inviter.seatIndex) : undefined
    );
    if (seatIndex === null) break;
    held.push({ seatIndex, inviteeId: invite.inviteeId, expiresAt });
    blocked.add(seatIndex);
  }
  return held;
}

/**
 * The seat this player takes, or null when every free seat is held for someone
 * else. Their own hold is taken first, so arriving late costs them nothing.
 */
export function seatForClaim(input: SeatingInput & { userId: string }): number | null {
  const held = heldSeats(input);
  const own = held.find((h) => h.inviteeId === input.userId);
  if (own) return own.seatIndex;

  const blocked = new Set([
    ...input.seated.map((p) => p.seatIndex),
    ...held.map((h) => h.seatIndex),
  ]);
  return bestFreeSeat(input.room, input.seated, blocked, undefined);
}
