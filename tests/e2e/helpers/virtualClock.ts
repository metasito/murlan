// One virtual clock for both sides of tests/e2e/helpers/mockupParity.ts (#1255). The measurements
// behind each step are #1250's findings, § "What I measured".
import type { Page } from "@playwright/test";
import { STEP_MS } from "./traceDiff.ts";
import { mulberry32 } from "../../support/game.ts";

declare global {
  interface Window {
    murlanStepAnimations(ms: number): void;
    murlanStep(ms: number): Promise<void>;
  }
}

/** Animations before timers: one a timer or rAF creates during the step then reads 0, as a browser reads 0 to 15 ms, not the whole step. */
async function orderedStep(ms: number, animations: (ms: number) => unknown, timers: (ms: number) => Promise<void>): Promise<void> {
  await animations(ms);
  await timers(ms);
}

export const EPOCH = new Date("2026-09-24T12:00:00Z");
const INSTALL_LEAD_MS = 60 * 60_000;

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
  const install = (generator: typeof mulberry32, seed: number, ordered: typeof orderedStep) => {
    Math.random = generator(seed);
    // Each animation is paused the first time it is seen and only then seeked: every seek of a running
    // one makes the DevTools Animation domain send its whole keyframe list (75 ms a step at 51 tracks of
    // 621 keyframes, against 8 paused). A paused animation never finishes on its own, so the seek that
    // reaches its end finishes it, and `animationend` and Reanimated's completions still fire. One the
    // app paused itself is not in the set and stays where it is. In the page so a spec's own stepping
    // loop calls this one rather than keeping a copy.
    const held = new WeakSet<Animation>();
    window.murlanStepAnimations = (ms) => {
      for (const a of document.getAnimations()) {
        if (!held.has(a) && a.playState === "running") {
          a.pause();
          held.add(a);
        }
        if (!held.has(a) || a.playState !== "paused" || a.currentTime === null) continue;
        const to = Number(a.currentTime) + ms;
        if (to >= Number(a.effect?.getComputedTiming().endTime ?? Infinity)) a.finish();
        else a.currentTime = to;
      }
    };
    window.murlanStep = async (ms) => {
      const clock = (globalThis as unknown as { __pwClock?: { controller: { runFor(ms: number): Promise<void> } } }).__pwClock?.controller;
      if (!clock) throw new Error("Playwright's in-page clock is not installed");
      await ordered(ms, window.murlanStepAnimations, (ms) => clock.runFor(ms));
    };
    // `page.clock` fakes performance.now() but not this stamp's performanceTime, which stays on the
    // real clock; the engine maps a moment's `at` through it, so every sound would read seconds late.
    AudioContext.prototype.getOutputTimestamp = function () {
      return { contextTime: this.currentTime, performanceTime: performance.now() };
    };
  };
  await page.addInitScript({ content: `(${String(install)})(${String(mulberry32)}, ${seed}, ${String(orderedStep)});` });
  // The blank page's clock runs in real time until the pause, and `pauseAt` throws once it has passed the time it is given.
  await page.clock.install({ time: EPOCH.getTime() - INSTALL_LEAD_MS });
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

/** Through `page.clock`, whose replay log carries the step into a document opened after it; `murlanStep` bypasses that log. */
export async function step(page: Page, ms: number = STEP_MS): Promise<void> {
  await orderedStep(ms, (ms) => page.evaluate((ms) => window.murlanStepAnimations(ms), ms), (ms) => page.clock.runFor(ms));
}

/** Every animation's name and `currentTime` now, in the order the document lists them. */
export async function animationPhase(page: Page): Promise<{ name: string; currentTime: number | null }[]> {
  return page.evaluate(() =>
    document.getAnimations().map((a) => ({
      name: a instanceof CSSAnimation ? a.animationName : a.id,
      currentTime: a.currentTime === null ? null : Number(a.currentTime),
    }))
  );
}

/**
 * `step`, then `read` evaluated in the page, in one round trip rather than three: each one waits
 * behind the frame the last step dirtied. It drives Playwright's in-page clock directly, which
 * leaves the step out of the log Playwright replays into a new document, so nothing may navigate
 * after it. `ms` null reads without stepping.
 */
export async function stepThen<T>(page: Page, ms: number | null, read: string): Promise<T> {
  return page.evaluate(`(async () => {
    const ms = ${ms};
    if (ms !== null) await globalThis.murlanStep(ms);
    return ${read};
  })()`) as Promise<T>;
}

/**
 * Tasks yielded after each frame. The paused clock never lets React's scheduler yield mid-work, but a render, the passive
 * effects of its commit and an update those effects schedule are each a task of their own, all behind the frame.
 */
const TASKS_AFTER_FRAME = 3;

/**
 * `n` frames in one round trip, each its own `murlanStep` followed by `TASKS_AFTER_FRAME` tasks, as a round trip per
 * frame gives React; `read` is evaluated after each. The same log caveat as `stepThen`.
 */
export function stepFrames<T = null>(page: Page, n: number, read = "null"): Promise<T[]> {
  if (!Number.isInteger(n) || n < 0) throw new Error(`stepFrames: ${n} is not a count of frames`);
  return page.evaluate(`(async () => {
    const task = () => new Promise((resolve) => {
      const ch = new MessageChannel();
      ch.port1.onmessage = () => resolve();
      ch.port2.postMessage(null);
    });
    const out = [];
    for (let i = 0; i < ${n}; i++) {
      await globalThis.murlanStep(${STEP_MS});
      for (let k = 0; k < ${TASKS_AFTER_FRAME}; k++) await task();
      out.push(${read});
    }
    return out;
  })()`) as Promise<T[]>;
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
 * Before the first navigation: gives the page `murlanEachPaint`. A sampler in a plain rAF callback
 * runs before Reanimated's own in the same frame, so it reads a React commit made between two frames
 * beside a transform the next frame's mapper has not yet written, a state the browser never paints.
 * This keeps one callback last in every frame, after all the page's. Install it after
 * `installVirtualClock`: the clock assigns `window.requestAnimationFrame` and would replace the
 * hook, so `murlanEachPaint` throws when a request no longer reaches it.
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
    let reached = false;
    const hooked = (cb: FrameRequestCallback) => {
      reached = true;
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
      reached = false;
      caf.call(window, window.requestAnimationFrame(() => {}));
      if (!reached) throw new Error("paintedFrames: window.requestAnimationFrame was replaced after it was installed; install it after installVirtualClock");
      samplers.push(sample);
      if (last) return;
      inFrame = false;
      arm();
    };
  };
  await page.addInitScript(install);
}
