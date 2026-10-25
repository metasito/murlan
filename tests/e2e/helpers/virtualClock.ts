// One virtual clock for both sides of tests/e2e/helpers/mockupParity.ts (#1255). The measurements
// behind each step are #1250's findings, § "What I measured".
import type { Page } from "@playwright/test";
import { STEP_MS } from "./traceDiff.ts";
import { mulberry32 } from "../../support/game.ts";

const EPOCH = new Date("2026-09-24T12:00:00Z");

/**
 * Must run before the first navigation: a clock installed after load lets time flow first, and
 * two runs then differ (the mockup's lamp sway moved up to 11 px). `page.clock` drives rAF and
 * timers but not CSS animations; CDP holds those still from the first frame, or a transition the
 * page starts on load runs in real time until it is held, and the first frame differs run to run.
 */
export async function installVirtualClock(page: Page, seed: number): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Animation.enable");
  await cdp.send("Animation.setPlaybackRate", { playbackRate: 0 });
  const install = (generator: typeof mulberry32, seed: number) => {
    Math.random = generator(seed);
    // `page.clock` fakes performance.now() but not this stamp's performanceTime, which stays on the
    // real clock; the engine maps a moment's `at` through it, so every sound would read seconds late.
    AudioContext.prototype.getOutputTimestamp = function () {
      return { contextTime: this.currentTime, performanceTime: performance.now() };
    };
  };
  await page.addInitScript({ content: `(${String(install)})(${String(mulberry32)}, ${seed});` });
  await page.clock.install({ time: EPOCH });
  await page.clock.pauseAt(EPOCH);
}

/**
 * After navigation, the clock onto rAF's grid: rAF fires at `16 - ticks % 16`, and the real
 * time that leaks in between `install` and `pauseAt` leaves ticks off it by a varying amount,
 * which reaches every animation that reads `performance.now()` when it starts.
 */
export async function takeOver(page: Page): Promise<void> {
  await page.clock.runFor(1);
  const ticks = await page.evaluate(() => performance.now());
  const offGrid = (STEP_MS - (ticks % STEP_MS)) % STEP_MS;
  if (offGrid > 0) await page.clock.runFor(offGrid);
}

export async function step(page: Page, ms: number = STEP_MS): Promise<void> {
  await page.clock.runFor(ms);
  await page.evaluate((ms) => {
    for (const a of document.getAnimations()) {
      if (a.currentTime !== null) a.currentTime = Number(a.currentTime) + ms;
    }
  }, ms);
}

/**
 * `step`, then `read` evaluated in the page, in one round trip rather than three: each one waits
 * behind the frame the last step dirtied. It drives Playwright's in-page clock directly, which
 * leaves the step out of the log Playwright replays into a new document, so nothing may navigate
 * after it. `ms` null reads without stepping.
 */
export async function stepThen<T>(page: Page, ms: number | null, read: string): Promise<T> {
  return page.evaluate(`(async () => {
    const clock = globalThis.__pwClock?.controller;
    if (!clock) throw new Error("Playwright's in-page clock is not installed");
    const ms = ${ms};
    if (ms !== null) {
      await clock.runFor(ms);
      for (const a of document.getAnimations()) {
        if (a.currentTime !== null) a.currentTime = Number(a.currentTime) + ms;
      }
    }
    return ${read};
  })()`) as Promise<T>;
}

/**
 * The app boots on real network events, so this advances virtual time in chunks while it polls,
 * against a real-time budget: a virtual one runs out before the bundle arrives.
 */
export async function stepUntil(
  page: Page,
  ready: () => Promise<boolean>,
  what: string,
  { chunkMs = STEP_MS * 6, realMs = 90_000 } = {}
): Promise<void> {
  const deadline = Date.now() + realMs;
  while (Date.now() < deadline) {
    if (await ready()) return;
    await step(page, chunkMs);
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`${what}: not ready after ${realMs} ms`);
}

/** `paintedFrames`' in-page hook: `sample` runs at the end of every frame until it returns false. */
export type EachPaint = (sample: (t: number) => boolean | void) => void;

/**
 * Before the first navigation, on either clock: gives the page `murlanEachPaint`. A sampler in a
 * plain rAF callback runs before Reanimated's own in the same frame, so it reads a React commit made
 * between two frames beside a transform the next frame's mapper has not yet written, a state the
 * browser never paints (#1829). This keeps one callback last in every frame, after all the page's.
 */
export async function paintedFrames(page: Page): Promise<void> {
  const install = () => {
    const raf = window.requestAnimationFrame;
    const caf = window.cancelAnimationFrame;
    const samplers: ((t: number) => boolean | void)[] = [];
    let last = 0;
    let inFrame = false;
    const close = (t: number) => {
      last = 0;
      inFrame = false;
      for (const s of [...samplers]) if (s(t) === false) samplers.splice(samplers.indexOf(s), 1);
      // Kept armed with no sampler left: only a frame `close` ends tells a request inside a frame from one between.
      arm();
    };
    const arm = () => {
      if (last) caf.call(window, last);
      last = raf.call(window, close);
    };
    // A request made inside a frame is for the next one, which `close` arms for itself; one made
    // between frames joins the frame `last` waits on, so `last` moves behind it.
    const hooked = (cb: FrameRequestCallback) => {
      const id = raf.call(window, (t: number) => {
        inFrame = true;
        cb(t);
      });
      if (last && !inFrame) arm();
      return id;
    };
    // The app wraps rAF in turn, calling what it read here, so its wrapper sits above the hook.
    let top: typeof window.requestAnimationFrame = hooked;
    Object.defineProperty(window, "requestAnimationFrame", { configurable: true, get: () => top, set: (v) => (top = v) });
    (window as unknown as { murlanEachPaint: EachPaint }).murlanEachPaint = (sample) => {
      samplers.push(sample);
      if (last) return;
      inFrame = false;
      arm();
    };
  };
  await page.addInitScript(install);
}
