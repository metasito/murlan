import type { GameState } from "@/lib/game/gameEngine";
import type { LampSide } from "./lampLegibility";

export interface BenchContext {
  params: Record<string, string | undefined>;
  showTable(state: GameState | null): Promise<void>;
  sleep(ms: number): Promise<void>;
  /** Opening with `until` (JS time) keeps the window to the first frame that ends past it. */
  frames(on: boolean, until?: number): void;
  /** Arming resolves once the frame loop is running. */
  armFrames(on: boolean): Promise<void>;
  /** Each seat's mean linear luminance round its ring, in one snapshot of the felt on screen; throws when there is none. */
  feltSample(): Promise<Readonly<Record<LampSide, number>>>;
  /** Each notice kind's gallery fixtures, by name. */
  gallery: Readonly<Record<string, readonly string[]>>;
  /** One gallery fixture mounted over the table, or none. */
  showNotice(shot: NoticeShot | null): void;
}

export type NoticeShot = { kind: string; fixture: number };

type Scenario = (ctx: BenchContext) => Promise<void>;
const scenarios = new Map<string, Scenario>();

export function registerBenchScenario(name: string, run: Scenario): void {
  scenarios.set(name, run);
}

/** The frame loop runs for the whole scenario, so each window's first frame has an interval. */
export function registerFramedScenario(name: string, run: Scenario): void {
  registerBenchScenario(name, async (ctx) => {
    const running = ctx.armFrames(true);
    try {
      await running;
      await run(ctx);
    } finally {
      ctx.armFrames(false);
    }
  });
}

export function benchScenarios(): [string, Scenario][] {
  return [...scenarios.entries()];
}
