import type { Page } from "@playwright/test";

/** What the page drew since it was last read, keyed by the `data-testid` nearest each canvas or styled element. */
export interface RenderCounts {
  /** WebGL draw calls and 2D clears, image draws and fills, as `<testid> webgl|2d`; a canvas outside the document is `offscreen`. */
  draws: Record<string, number>;
  /** Of `frames`, how many each key drew in. */
  drewIn: Record<string, number>;
  /** Frames the counter's own `requestAnimationFrame` loop saw. */
  frames: number;
  readPixels: number;
  /** Style attribute writes under `game-root`; anything inside a card's own view is `cards`. */
  styles: Record<string, number>;
}

/** A card's view: the drawn box, or the wrapper every table card carries a `card-…` native id on. */
const CARD = '[data-testid="card-box"], [id^="card-"]';

/** Before the first navigation. */
export async function countRenders(page: Page): Promise<void> {
  await page.addInitScript((card: string) => {
    const fresh = () => ({ draws: {} as Record<string, number>, drewIn: {} as Record<string, number>, frames: 0, readPixels: 0, styles: {} as Record<string, number> });
    let counts = fresh();
    let frame = 0;
    const lastFrame: Record<string, number> = {};
    const bump = (into: Record<string, number>, key: string) => (into[key] = (into[key] ?? 0) + 1);
    type Ctx = { canvas?: HTMLCanvasElement | OffscreenCanvas };
    const draw = (self: Ctx, kind: string) => {
      const canvas = self.canvas;
      const key =
        canvas instanceof HTMLCanvasElement && canvas.isConnected
          ? `${canvas.closest("[data-testid]")?.getAttribute("data-testid") ?? "(untagged)"} ${kind}`
          : "offscreen";
      bump(counts.draws, key);
      if (lastFrame[key] === frame) return;
      lastFrame[key] = frame;
      bump(counts.drewIn, key);
    };
    const patch = (proto: object | undefined, name: string, count: (self: Ctx) => void) => {
      if (!proto) return;
      const original = (proto as Record<string, (...args: unknown[]) => unknown>)[name];
      if (typeof original !== "function") return;
      (proto as Record<string, unknown>)[name] = function (this: Ctx, ...args: unknown[]) {
        count(this);
        return original.apply(this, args);
      };
    };
    for (const gl of [globalThis.WebGLRenderingContext, globalThis.WebGL2RenderingContext]) {
      patch(gl?.prototype, "drawArrays", (self) => draw(self, "webgl"));
      patch(gl?.prototype, "drawElements", (self) => draw(self, "webgl"));
      patch(gl?.prototype, "readPixels", () => counts.readPixels++);
    }
    for (const ctx of [globalThis.CanvasRenderingContext2D, globalThis.OffscreenCanvasRenderingContext2D]) {
      for (const name of ["clearRect", "drawImage", "fill"]) patch(ctx?.prototype, name, (self) => draw(self, "2d"));
    }
    // Started on demand rather than here: a virtual clock installed after this script replaces `requestAnimationFrame`.
    let started = false;
    const start = () => {
      if (started) return true;
      const root = document.querySelector('[data-testid="game-root"]');
      if (!root) return false;
      started = true;
      new MutationObserver((records) => {
        for (const r of records) {
          const el = r.target as Element;
          bump(counts.styles, el.closest(card) ? "cards" : (el.closest("[data-testid]")?.getAttribute("data-testid") ?? "(untagged)"));
        }
      }).observe(root, { subtree: true, attributes: true, attributeFilter: ["style"] });
      const tick = () => {
        frame++;
        counts.frames++;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      return true;
    };
    const take = () => {
      const out = counts;
      counts = fresh();
      return out;
    };
    (window as unknown as { murlanRenderCounts: { start(): boolean; take(): typeof counts } }).murlanRenderCounts = { start, take };
  }, CARD);
}

/** Starts counting frames and style writes, once, and resets the counts so far; the table must be mounted. */
export async function startRenderCounts(page: Page): Promise<void> {
  const found = await page.evaluate(() => {
    const counter = (window as unknown as { murlanRenderCounts: { start(): boolean; take(): unknown } }).murlanRenderCounts;
    counter.take();
    return counter.start();
  });
  if (!found) throw new Error("startRenderCounts: the page has no game-root");
}

/** The in-page expression that reads and resets the counts, for `stepThen` or `page.evaluate`. */
export const TAKE_RENDER_COUNTS = "window.murlanRenderCounts.take()";

/** Skia's web canvases carry no `testID` of their own: each is named by the view it lies in. */
export const COUNTED = { felt: "table-felt webgl", feltFallback: "table-felt 2d", handShade: "card-shade webgl", particles: "particles 2d" } as const;
