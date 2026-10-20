import { startRound, type GameState } from "@/lib/game/gameEngine";
import { offlineBotMove } from "@/lib/game/autoMove";
import type { BenchContext } from "./bench";

export function benchTable(): GameState {
  return startRound(
    [
      { name: "You", type: "human" },
      { name: "A", type: "bot" },
      { name: "B", type: "bot" },
      { name: "C", type: "bot" },
    ],
    "free_for_all"
  );
}

export function botTable(): GameState {
  return startRound(["A", "B", "C", "D"].map((name) => ({ name, type: "bot" as const })), "free_for_all");
}

export async function driveBots(
  ctx: BenchContext,
  state: GameState,
  stepMs: number,
  onStep?: (s: GameState) => void,
  stop: () => boolean = () => false
): Promise<GameState> {
  await ctx.showTable(state);
  while (!state.roundOver && !stop()) {
    const next = offlineBotMove(state)?.state;
    if (!next) break;
    state = next;
    onStep?.(state);
    await ctx.showTable(state);
    await ctx.sleep(stepMs);
  }
  return state;
}
