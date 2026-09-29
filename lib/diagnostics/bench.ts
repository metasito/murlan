import type { GameState } from "@/lib/game/gameEngine";
import type { LampSide } from "./lampLegibility";

export interface BenchContext {
  params: Record<string, string | undefined>;
  showTable(state: GameState | null): Promise<void>;
  sleep(ms: number): Promise<void>;
  frames(on: boolean): void;
  /** Each seat's mean linear luminance round its ring, in one snapshot of the felt on screen; throws when there is none. */
  feltSample(): Promise<Readonly<Record<LampSide, number>>>;
}

type Scenario = (ctx: BenchContext) => Promise<void>;
const scenarios = new Map<string, Scenario>();

export function registerBenchScenario(name: string, run: Scenario): void {
  scenarios.set(name, run);
}

export function benchScenarios(): [string, Scenario][] {
  return [...scenarios.entries()];
}
