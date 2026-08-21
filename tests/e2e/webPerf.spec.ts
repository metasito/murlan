// tests/e2e/webPerf.spec.ts — what the web build actually costs a frame.
//
// Expo's Performance Monitor and the React DevTools Profiler are native-only,
// so the platform most players use has no first-party profiler. #95's ceiling
// governs every visual ticket on the #94 map — Reanimated on web is plain
// JavaScript on the main thread, with a documented limit around 100
// concurrently animating components — and that is a budget nobody could
// observe.
//
// This records; it does not gate. The default suite ignores this file, so
// `npm run test:e2e` costs nothing and gains no noise from it. Run it with
// `npm run perf:web`, and see docs/WEB-PERF.md for what the numbers mean and
// what to compare them against.
import { test, expect } from "./fixtures";
import { openApp, startOfflineGame } from "./helpers/navigation";

const TABLE = '[data-testid="game-table"]';

interface FrameReport {
  frames: number;
  /** Milliseconds between presented frames — 16.7 is one frame at 60fps. */
  p50: number;
  p95: number;
  worst: number;
  /** Frames that took longer than two 60fps frames to arrive. */
  janky: number;
  longTasks: number;
  longTaskMs: number;
  /** Elements carrying a non-identity transform when sampled. */
  transformed: number;
  domNodes: number;
}

/**
 * Watches real presented frames via requestAnimationFrame, and long tasks via
 * PerformanceObserver, for `ms`. rAF rather than a frame-timing API because it
 * is what every browser has, and it measures the thing that matters here:
 * whether the main thread got back in time to paint.
 */
async function record(page: import("@playwright/test").Page, ms: number): Promise<FrameReport> {
  return page.evaluate(async (duration) => {
    const intervals: number[] = [];
    let longTasks = 0;
    let longTaskMs = 0;

    let observer: PerformanceObserver | null = null;
    try {
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          longTasks += 1;
          longTaskMs += entry.duration;
        }
      });
      observer.observe({ entryTypes: ["longtask"] });
    } catch {
      // Not every engine exposes longtask; the frame intervals still stand.
    }

    await new Promise<void>((resolve) => {
      let last = performance.now();
      const started = last;
      const tick = (now: number) => {
        intervals.push(now - last);
        last = now;
        if (now - started >= duration) resolve();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    observer?.disconnect();

    // The first interval spans from before the loop started, so it measures
    // scheduling latency rather than a frame.
    const sorted = intervals.slice(1).sort((a, b) => a - b);
    const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0;

    const transformed = [...document.querySelectorAll("*")].filter((el) => {
      const t = getComputedStyle(el).transform;
      return t && t !== "none";
    }).length;

    return {
      frames: sorted.length,
      p50: +at(0.5).toFixed(2),
      p95: +at(0.95).toFixed(2),
      worst: +(sorted[sorted.length - 1] ?? 0).toFixed(2),
      janky: sorted.filter((ms) => ms > 33.4).length,
      longTasks,
      longTaskMs: +longTaskMs.toFixed(1),
      transformed,
      domNodes: document.querySelectorAll("*").length,
    };
  }, ms);
}

test.describe("web frame performance", () => {
  test("records a baseline through the deal and the first plays", async ({ page, baseURL }) => {
    test.setTimeout(3 * 60_000);

    await openApp(page, baseURL!);
    // Recording starts on the click that begins the game, not after the table
    // has settled: the deal is the burst worth measuring, and waiting for the
    // table first is waiting for the burst to be over. An earlier draft of this
    // did exactly that and reported a flat 60fps with no jank at all.
    await startOfflineGame(page, { playerCount: 4, gameMode: "free_for_all" });
    const deal = await record(page, 3_000);
    await page.locator(TABLE).waitFor({ timeout: 60_000 });

    // Then a settled table, as the control. The difference between the two is
    // the cost of the animation rather than the cost of the page.
    await page.waitForTimeout(2_000);
    const idle = await record(page, 2_000);

    console.log(`[web-perf] deal ${JSON.stringify(deal)}`);
    console.log(`[web-perf] idle ${JSON.stringify(idle)}`);

    // The only assertions are anti-vacuity ones. A threshold here would be the
    // flaky gate this was explicitly not to become — the numbers above are the
    // deliverable, compared by hand against docs/WEB-PERF.md.
    expect(deal.frames, "no frames were observed, so nothing was measured").toBeGreaterThan(30);
    expect(idle.frames, "no frames were observed on the settled table").toBeGreaterThan(20);
    expect(deal.domNodes, "the table never rendered").toBeGreaterThan(100);
  });
});
