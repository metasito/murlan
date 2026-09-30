import { initializeGame, type GameState } from "@/lib/game/gameEngine";
import { offlineBotMove, resolveStuckExchange } from "@/lib/game/autoMove";
import type { BenchContext } from "./bench";

export function benchTable(): GameState {
  return initializeGame(
    [
      { name: "You", type: "human" },
      { name: "A", type: "ai" },
      { name: "B", type: "ai" },
      { name: "C", type: "ai" },
    ],
    "free_for_all"
  );
}

export function botTable(): GameState {
  return initializeGame(["A", "B", "C", "D"].map((name) => ({ name, type: "ai" as const })), "free_for_all");
}

export async function driveBots(
  ctx: BenchContext,
  state: GameState,
  stepMs: number,
  onStep?: (s: GameState) => void,
  stop: () => boolean = () => false
): Promise<GameState> {
  await ctx.showTable(state);
  while (!state.gameOver && !stop()) {
    const next = offlineBotMove(state) ?? (state.exchangePhase?.active ? resolveStuckExchange(state) : null);
    if (!next) break;
    state = next;
    onStep?.(state);
    await ctx.showTable(state);
    await ctx.sleep(stepMs);
  }
  return state;
}
