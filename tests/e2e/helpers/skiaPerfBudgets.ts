// A target (RULES.md 52), set by docs/adr/0018-the-skia-table-is-held-to-counted-budgets.md.

/** Per window of tests/e2e/skiaPerf.spec.ts: between them, every draw and style write the counters see. */
export interface WindowBudget {
  /** WebGL draw calls on the page's canvases, per frame. */
  glDrawsPerFrame: number;
  /** 2D clears, image draws and fills on the page's canvases, through the window. */
  canvas2dDraws: number;
  /** Draws on canvases outside the document, through the window. */
  offscreenDraws: number;
  readPixels: number;
  /** Style attribute writes anywhere under `game-root`, through the window. */
  styleWrites: number;
  /** Of `styleWrites`, those inside a card's view. */
  cardStyles?: number;
  /** Frames, of the window's, the felt's canvas drew in. */
  feltFrames?: number;
}

export const BUDGETS = {
  rest: { feltFrames: 89, glDrawsPerFrame: 5.1, canvas2dDraws: 1580, offscreenDraws: 0, readPixels: 0, styleWrites: 0 },
  turn: { glDrawsPerFrame: 35.5, canvas2dDraws: 11850, offscreenDraws: 4, readPixels: 0, styleWrites: 17700, cardStyles: 16800 },
} as const satisfies Record<string, WindowBudget>;
