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
  /** `requestAnimationFrame` callbacks that ran, by the caller that requested them; the counter's own and the trace recorder's tick are left out. */
  loops: Record<string, number>;
  /** Reanimated frame callbacks active in the window's last frame; each keeps a loop running while it is. */
  frameCallbacks: number;
  /** Style attribute writes under `game-root`; anything inside a card's own view is `cards`. */
  styles: Record<string, number>;
}

/** A card's view: the drawn box, or the wrapper every table card carries a `card-…` native id on. */
const CARD = '[data-testid="card-box"], [id^="card-"]';

/** Before the first navigation. */
export async function countRenders(page: Page): Promise<void> {
  await page.addInitScript((card: string) => {
    const fresh = () => ({ draws: {} as Record<string, number>, drewIn: {} as Record<string, number>, frames: 0, readPixels: 0, loops: {} as Record<string, number>, frameCallbacks: 0, styles: {} as Record<string, number> });
    let counts = fresh();
    let frame = 0;
    let lastFrame: Record<string, number> = {};
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
    let started = false;
    // Not counted: the counter's own tick, the trace recorder's, and what a spec hands to `exempt`.
    const exempt = new WeakSet<object>();
    let tracerStarting = false;
    let reached = false;
    const registry = () => (globalThis as unknown as { _frameCallbackRegistry?: { activeFrameCallbacks: Set<number> } })._frameCallbackRegistry;
    // The recorder's tick is the one function it asks a frame for while `start` runs, and again each frame.
    // Wrapping at the assignment keeps this wrapper outside the recorder's own, so it sees the callbacks
    // callers pass rather than the recorder's closures, and before any spec starts the trace.
    let tracer: { start(): void } | undefined;
    Object.defineProperty(window, "murlanTrace", {
      configurable: true,
      get: () => tracer,
      set(value: { start(): void }) {
        tracer = value;
        const start = value.start.bind(value);
        value.start = () => {
          tracerStarting = true;
          try {
            start();
          } finally {
            tracerStarting = false;
          }
        };
        const request = window.requestAnimationFrame.bind(window);
        window.requestAnimationFrame = (callback) => {
          reached = true;
          if (tracerStarting) exempt.add(callback);
          if (!started || exempt.has(callback)) return request(callback);
          const caller = (new Error().stack ?? "").split("\n")[2]?.trim().replace(/^at /, "").replace(/:\d+\)?$/, "") ?? "(unknown)";
          return request((t) => {
            bump(counts.loops, caller);
            callback(t);
          });
        };
      },
    });
    // Started on demand rather than here: a virtual clock installed after this script replaces `requestAnimationFrame`.
    const start = () => {
      if (started) return true;
      const root = document.querySelector('[data-testid="game-root"]');
      if (!root) return false;
      if (!(registry()?.activeFrameCallbacks instanceof Set)) throw new Error("renderCounters: the page has no Reanimated frame callback registry to count");
      reached = false;
      window.cancelAnimationFrame(window.requestAnimationFrame(() => {}));
      if (!reached) throw new Error("renderCounters: requestAnimationFrame is not wrapped");
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
        counts.frameCallbacks = registry()!.activeFrameCallbacks.size;
        requestAnimationFrame(tick);
      };
      exempt.add(tick);
      requestAnimationFrame(tick);
      return true;
    };
    const take = () => {
      const out = counts;
      counts = fresh();
      lastFrame = {};
      return out;
    };
    (window as unknown as { murlanRenderCounts: { start(): boolean; take(): typeof counts; exempt(callback: object): void } }).murlanRenderCounts = { start, take, exempt: (callback: object) => void exempt.add(callback) };
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
export const COUNTED = { felt: "table-felt webgl",handShade: "card-shade webgl", particles: "particles 2d" } as const;

const DESIGN_WIDTH = 874;
const SWAY_PT = 20;
const LEAN_REACH_PT = 120;
const LEAN_FLOOR = 1;

/**
 * The settled felt's end-B layer, when it has one: its opacity now, how many of its animations run, and which way its picture leans.
 * End B is lit from a sway ahead of the target, so across a row through the light the pixels right of it are brighter than those
 * left of it (`lean`, in 8-bit levels, from a 2D `getImageData`, never a WebGL read); a copy of end A leans the other way.
 * The target is the rig's light less the sway the layer's opacity says it is at. In-page, for `page.evaluate`; needs the trace running.
 */
export const END_B_SAMPLE = `(() => {
  const canvas = document.querySelector('[data-testid="felt-end-b"]');
  const frame = window.murlanTrace?.frames.at(-1);
  if (!canvas || canvas.style.visibility !== "visible" || !frame) return null;
  const opacity = Number(getComputedStyle(canvas.parentElement).opacity);
  const pt = innerWidth / ${DESIGN_WIDTH};
  const px = canvas.width / innerWidth;
  const target = frame.lamp.x - ${SWAY_PT} * pt * (2 * opacity - 1);
  const patch = (x) => {
    const half = Math.round(8 * px);
    const { data } = canvas.getContext("2d").getImageData(Math.round(x * px) - half, Math.round(frame.lamp.y * px) - half, 2 * half, 2 * half);
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) sum += data[i] + data[i + 1] + data[i + 2];
    return sum / (data.length / 4) / 3;
  };
  const reach = ${LEAN_REACH_PT} * pt;
  return { opacity, running: canvas.parentElement.getAnimations().filter((a) => a.playState === "running").length, lean: patch(target + reach) - patch(target - reach) };
})()`;

export interface EndBSample {
  opacity: number;
  running: number;
  lean: number;
}

/** Opacity the end-B layer must move by across the samples: its sway runs the whole of 0 to 1, so two seconds of it cannot lie within this. */
const SWAY_SHOWN = 0.02;
/** Levels end B must lean toward its side of the light: half of what the baked end measures, 8-bit levels right of the target less left of it, a point-source-free cloth reading about -/+ that in either end. */
const LEANS_TOWARD_B = LEAN_FLOOR;

/** Whether the sway is visible without the felt redrawing: every sample found the layer with an animation running and a picture lit from the far end, and its opacity moved between them. A table with no such layer, a frozen one, or one whose end B is a copy of end A is not. */
export function swayShows(samples: (EndBSample | null)[]): boolean {
  const seen = samples.filter((s): s is EndBSample => s !== null);
  if (seen.length < 2 || seen.length !== samples.length || seen.some((s) => s.running < 1 || !(s.lean >= LEANS_TOWARD_B))) return false;
  const opacities = seen.map((s) => s.opacity);
  return Math.max(...opacities) - Math.min(...opacities) >= SWAY_SHOWN;
}
