import { startRound, type GameMode, type GameState, type SeatSetup } from "./game/gameEngine.ts";

/** The launch argument ios.yml's flows pass so that the viewer's seat opens, and their tap on a card always runs. */
export const E2E_OPENER_KEY = "MurlanE2EOpener";

/** A first deal from the seat given, dealt again until `seat` is the one to open. */
export function initializeOpeningAt(
  players: readonly SeatSetup[],
  mode: GameMode,
  seat: number
): (firstSeat: number) => GameState {
  return (firstSeat) => {
    for (;;) {
      const state = startRound(players, mode, { firstSeat });
      if (state.currentTurnIndex === seat) return state;
    }
  };
}
