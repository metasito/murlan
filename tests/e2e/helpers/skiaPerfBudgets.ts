// A target (RULES.md 52), set by docs/adr/0018-the-skia-table-is-held-to-counted-budgets.md.

/** Per window of tests/e2e/skiaPerf.spec.ts: counts only, each the same seed draws on any runner. */
export interface WindowBudget {
  /** WebGL draw calls on the page's canvases, per frame. */
  glDrawsPerFrame: number;
  /** Draws on canvases outside the document, through the window. */
  offscreenDraws: number;
  readPixels: number;
  /** Style attribute writes inside a card's view, through the window. */
  cardStyles: number;
  /** Frames, of the window's, the felt's canvas drew in. */
  feltFrames?: number;
}

export const BUDGETS = {
  rest: { feltFrames: 96, glDrawsPerFrame: 5.5, offscreenDraws: 0, readPixels: 0, cardStyles: 0 },
  turn: { glDrawsPerFrame: 38, offscreenDraws: 8, readPixels: 0, cardStyles: 18000 },
} as const satisfies Record<string, WindowBudget>;
