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

export interface ScenarioOptions {
  /** Screen capture is where the audio-onset rows come from, and it costs frames: only a scenario that reads those rows has it on. */
  capture?: boolean;
}

const scenarios = new Map<string, { run: Scenario; capture: boolean }>();

export function registerBenchScenario(name: string, run: Scenario, options: ScenarioOptions = {}): void {
  scenarios.set(name, { run, capture: options.capture ?? false });
}

/** The frame loop runs for the whole scenario, so each window's first frame has an interval. */
export function registerFramedScenario(name: string, run: Scenario, options?: ScenarioOptions): void {
  registerBenchScenario(
    name,
    async (ctx) => {
      const running = ctx.armFrames(true);
      try {
        await running;
        await run(ctx);
      } finally {
        ctx.frames(false);
        ctx.armFrames(false);
      }
    },
    options
  );
}

export function benchScenarios(): [string, Scenario][] {
  return [...scenarios.entries()].map(([name, { run }]) => [name, run]);
}

export const needsCapture = (name: string): boolean => scenarios.get(name)?.capture ?? false;
