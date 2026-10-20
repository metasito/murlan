import type { OnlineGameState } from "../../server/game/gameRoom.ts";
import { freshMemory } from "../../server/game/tableState.ts";

/**
 * A live table for a unit test, with nothing seated and nothing dealt. A test
 * that reaches `gameState` passes one: the default is deliberately absent.
 */
export function onlineTable(
  overrides: Partial<OnlineGameState> & Pick<OnlineGameState, "roomId">
): OnlineGameState {
  return {
    joinCode: "AAAAAA",
    playerMap: {},
    cumulativeScores: {},
    maxPlayers: 4,
    matchTarget: 21,
    matchLength: "match",
    roundsPlayed: 0,
    matchOver: false,
    roundFlags: {},
    abandonedSeats: new Map(),
    botSeatsAtStart: new Set(),
    releasedSeats: new Set(),
    vacatedSeats: new Map(),
    weakSeats: new Set(),
    dealFirstSeat: 0,
    ...freshMemory(null),
    ...overrides,
  } as OnlineGameState;
}
