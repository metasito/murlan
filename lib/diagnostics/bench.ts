import type { GameState } from "@/lib/game/gameEngine";

export interface BenchContext {
  params: Record<string, string | undefined>;
  showTable(state: GameState | null): Promise<void>;
  sleep(ms: number): Promise<void>;
  frames(on: boolean): void;
}

type Scenario = (ctx: BenchContext) => Promise<void>;
const scenarios = new Map<string, Scenario>();

export function registerBenchScenario(name: string, run: Scenario): void {
  scenarios.set(name, run);
}

export function benchScenarios(): [string, Scenario][] {
  return [...scenarios.entries()];
}
