import { initializeGame, type GameMode, type GameState } from "./game/gameEngine.ts";

/** The launch argument ios.yml's flows pass so that the viewer's seat opens, and their tap on a card always runs. */
export const E2E_OPENER_KEY = "MurlanE2EOpener";

/** `initializeGame`, dealt again until `seat` is the one to open. */
export function initializeOpeningAt(
  players: Parameters<typeof initializeGame>[0],
  mode: GameMode,
  firstSeat: number,
  seat: number
): GameState {
  for (;;) {
    const state = initializeGame(players, mode, firstSeat);
    if (state.currentTurnIndex === seat) return state;
  }
}
