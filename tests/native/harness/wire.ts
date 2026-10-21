import type { GameState } from '@/lib/game/gameEngine';
import type { RoundOverPayload } from '@/lib/game/matchState';
import type { WireGameState, WireRoomState } from '@/shared/protocol';

/** `state` as the server sends it to the player at `viewer`: every other seat's hand is only a count, and a seat is vacated only if it says so. */
export function wire(state: GameState, viewer: number | null, over: Partial<WireGameState> = {}): WireGameState {
  return {
    ...state,
    viewerSeatIndex: viewer,
    turnSecondsRemaining: 0,
    players: state.players.map((p, seat) => ({
      vacated: false,
      ...p,
      hand: seat === viewer ? p.hand : [],
      handCount: p.hand.length,
    })),
    ...over,
  };
}

/** A private four-seat lobby `R1`, code `ABCD`, that `hostUserId` opened and sits alone in. */
export function room(over: Partial<WireRoomState> = {}): WireRoomState {
  return {
    roomId: 'R1',
    code: 'ABCD',
    hostUserId: 'u1',
    status: 'waiting',
    gameMode: 'free_for_all',
    visibility: 'private',
    maxPlayers: 4,
    players: [{ seatIndex: 0, userId: over.hostUserId ?? 'u1', username: 'Ana' }],
    ...over,
  };
}

/** The server's word on `state`'s round: each seat's placement `points`, and `totals` equal to them unless given. */
export function roundOver(
  state: GameState,
  points: Record<string, number>,
  { totals = points, ...over }: Partial<RoundOverPayload> & { totals?: Record<string, number> } = {}
): RoundOverPayload {
  return {
    finishingOrder: state.finishingOrder,
    scores: state.players.map((p, seatIndex) => ({
      seatIndex,
      engineId: p.id,
      userId: null,
      username: p.name,
      points: points[p.id] ?? 0,
      total: totals[p.id] ?? 0,
      vacated: false,
    })),
    matchTarget: 21,
    matchLength: 'match',
    roundsPlayed: 1,
    matchOver: false,
    matchWinnerIds: [],
    matchContinues: true,
    isDraw: false,
    ratingDeltas: {},
    ratingsAfter: {},
    recorded: true,
    voided: false,
    ...over,
  };
}
