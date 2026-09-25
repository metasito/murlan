// One virtual clock for both sides of tests/e2e/helpers/mockupParity.ts (#1255). The measurements
// behind each step are #1250's findings, § "What I measured".
import type { Page } from "@playwright/test";
import { STEP_MS } from "./traceDiff";

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
  await page.addInitScript((seed) => {
    let s = seed >>> 0;
    Math.random = () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = Math.imul(s ^ (s >>> 15), s | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }, seed);
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
