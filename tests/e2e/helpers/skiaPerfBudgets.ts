// What tests/e2e/skiaPerf.spec.ts lets the Skia table cost a stepped frame at 4x CPU (RULES.md 51).
// A target (TARGETS, tools/ci/target-freeze.mjs): a budget moves only in a pull request of its own,
// touching nothing under app/, components/ or lib/, that cites the owner's ruling moving it.

export interface WindowBudget {
  /** WebGL draw calls across every canvas, per frame: the same seed draws the same calls on any runner. */
  glDrawsPerFrame: number;
  /** Main-thread script, CDP's `ScriptDuration`, per frame: the runner's speed moves it, so it holds twice the worst measured. */
  scriptMsPerFrame: number;
  /** Frames, of the window's, the felt's canvas drew in. */
  feltFrames?: number;
  /** Tasks over 50 ms through the window. */
  longTasks?: number;
}

export const BUDGETS = {
  rest: { feltFrames: 96, glDrawsPerFrame: 5.5, scriptMsPerFrame: 9, longTasks: 12 },
  turn: { glDrawsPerFrame: 38, scriptMsPerFrame: 34 },
} as const satisfies Record<string, WindowBudget>;
