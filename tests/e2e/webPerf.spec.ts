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
import type { CDPSession, Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { openApp, startOfflineGame } from "./helpers/navigation";
import { openSeededGame } from "./helpers/offlineSeed";
import { openOnlineTable } from "./helpers/onlineTable";
import { driveGameToCompletion, playAnyLegal } from "./helpers/bot";
import { YOUR_TURN_PREFIX } from "./helpers/labels";
import { HAND_CARDS, TABLE_STATE } from "./helpers/selectors";
import { PAST_HOLD_MS } from "./helpers/press";
import { skiaOnSoftware, untilSkiaFelt } from "./helpers/tableTrace";
import { COUNTED, countRenders, startRenderCounts, TAKE_RENDER_COUNTS, type RenderCounts } from "./helpers/renderCounters";
import type { TraceFrame } from "../../lib/e2eTrace";

const TABLE = '[data-testid="game-table"]';

/** The Skia felt on this software rasteriser, which only an e2e build honours (`drawsOnGpu`, feltSkia.web.tsx). */
const SKIA = process.env.PERF_SKIA === "1";

/** Recorded under PERF_SKIA alone: its counters and trace cost the page they measure. */
interface RenderReport {
  /** Frames per second each canvas drew in, and style writes a second inside cards' views. */
  feltFps: number;
  particlesFps: number;
  handShadeFps: number;
  cardStylesPerS: number;
  /** Which felt the trace saw draw through the window. */
  felts: TraceFrame["felt"][];
}

interface FrameReport extends Partial<RenderReport> {
  frames: number;
  /** Main-thread milliseconds a second, from CDP's `Performance.getMetrics`. */
  taskMsPerS: number;
  scriptMsPerS: number;
  /** Presented frames per second over the window; 60 is a table holding the display's rate. */
  fps: number;
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

// A phone, not a desktop: the owner's table is an iPhone 16 Pro in landscape at 3x, and
// every case runs with motion on because that is how it is played (#1965). Skia on SwiftShader at
// 3x draws about four frames a second, under every window's floor, so PERF_SKIA records at 1x.
test.use({ reducedMotion: "no-preference", deviceScaleFactor: SKIA ? 1 : 3 });

const PHONE_VIEWPORT = { width: 874, height: 402 };
/** Lighthouse's mobile CPU preset. */
const PHONE_CPU_RATE = 4;

const throttles = new WeakMap<Page, CDPSession>();

/** One session a page: a throttle is that session's own override, so a second session's would not replace it. */
async function throttleCpu(page: Page, rate: number): Promise<void> {
  const cdp = throttles.get(page) ?? (await page.context().newCDPSession(page));
  throttles.set(page, cdp);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate });
}

/**
 * Watches real presented frames via requestAnimationFrame, and long tasks via
 * PerformanceObserver, from now until `stop()`. rAF rather than a frame-timing
 * API because it is what every browser has, and it measures the thing that
 * matters here: whether the main thread got back in time to paint.
 */
async function startRecording(page: Page): Promise<{ stop(): Promise<FrameReport> }> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  const metrics = async () => {
    const { metrics: all } = await cdp.send("Performance.getMetrics");
    const of = (name: string) => all.find((m) => m.name === name)?.value ?? 0;
    return { at: Date.now(), task: of("TaskDuration"), script: of("ScriptDuration") };
  };
  if (SKIA) {
    await startRenderCounts(page);
    await page.evaluate(() => (window as unknown as { murlanTrace: { start(): void } }).murlanTrace.start());
  }
  const from = await metrics();
  await page.evaluate(() => {
    const rec = { times: [] as number[], longTasks: 0, longTaskMs: 0, running: true };
    (window as unknown as { __perfRec: typeof rec }).__perfRec = rec;
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          rec.longTasks += 1;
          rec.longTaskMs += entry.duration;
        }
      }).observe({ entryTypes: ["longtask"] });
    } catch {
      // Not every engine exposes longtask; the frame intervals still stand.
    }
    const tick = (now: number) => {
      rec.times.push(now);
      if (rec.running) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  return {
    stop: async () => {
      const to = await metrics();
      const seconds = (to.at - from.at) / 1000;
      const perS = (n: number | undefined) => +((n ?? 0) / seconds).toFixed(1);
      const cost = { taskMsPerS: perS((to.task - from.task) * 1000), scriptMsPerS: perS((to.script - from.script) * 1000) };
      const render = SKIA ? await renderReport(page, perS) : {};
      const frames = await page.evaluate(() => {
        const rec = (window as unknown as {
          __perfRec: { times: number[]; longTasks: number; longTaskMs: number; running: boolean };
        }).__perfRec;
        rec.running = false;

        const sorted = rec.times
          .slice(1)
          .map((t, i) => t - rec.times[i]!)
          .sort((a, b) => a - b);
        const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0;
        const span = (rec.times[rec.times.length - 1]! - rec.times[0]!) / 1000;

        const transformed = [...document.querySelectorAll("*")].filter((el) => {
          const t = getComputedStyle(el).transform;
          return t && t !== "none";
        }).length;

        return {
          frames: sorted.length,
          fps: span > 0 ? +(sorted.length / span).toFixed(1) : 0,
          p50: +at(0.5).toFixed(2),
          p95: +at(0.95).toFixed(2),
          worst: +(sorted[sorted.length - 1] ?? 0).toFixed(2),
          janky: sorted.filter((ms) => ms > 33.4).length,
          longTasks: rec.longTasks,
          longTaskMs: +rec.longTaskMs.toFixed(1),
          transformed,
          domNodes: document.querySelectorAll("*").length,
        };
      });
      await cdp.detach();
      return { ...frames, ...cost, ...render };
    },
  };
}

async function renderReport(page: Page, perS: (n: number | undefined) => number): Promise<RenderReport> {
  const counts = await page.evaluate<RenderCounts>(TAKE_RENDER_COUNTS);
  const felts = await page.evaluate(() => {
    const trace = (window as unknown as { murlanTrace: { frames: TraceFrame[]; stop(): void } }).murlanTrace;
    trace.stop();
    return [...new Set(trace.frames.map((f) => f.felt))];
  });
  return {
    feltFps: perS(counts.drewIn[COUNTED.felt]),
    particlesFps: perS(counts.drewIn[COUNTED.particles]),
    handShadeFps: perS(counts.drewIn[COUNTED.handShade]),
    cardStylesPerS: perS(counts.styles.cards),
    felts,
  };
}

async function record(page: Page, ms: number): Promise<FrameReport> {
  const recording = await startRecording(page);
  // fixed wait on purpose: the window is the measurement
  await page.waitForTimeout(ms);
  return recording.stop();
}

/** The viewer holds the lead or the turn: nothing but ambient motion is running. */
async function waitForViewerTurn(page: Page): Promise<void> {
  await page
    .locator(`${TABLE}[${TABLE_STATE}^="${YOUR_TURN_PREFIX}"]`)
    .waitFor({ timeout: 120_000 });
  // fixed wait on purpose: the turn's own entrance has to finish before ambient motion is all that runs
  await page.waitForTimeout(1_000);
}

/** Under PERF_SKIA, waits for the Skia felt; a window it recorded must have drawn that felt alone. */
async function skiaFelt(page: Page): Promise<void> {
  if (SKIA) await untilSkiaFelt(page, 120_000);
}

function expectSkia(report: FrameReport, what: string): void {
  if (SKIA) expect(report.felts, `the felts the trace saw through ${what}`).toEqual(["skia"]);
}

test.describe("web frame performance", () => {
  test.beforeEach(async ({ page }) => {
    if (!SKIA) return;
    await countRenders(page);
    await skiaOnSoftware(page);
  });

  test("records a baseline through the deal and the first plays", async ({ page, baseURL }) => {
    test.setTimeout(3 * 60_000);

    await page.setViewportSize(PHONE_VIEWPORT);
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
    await skiaFelt(page);
    const idle = await record(page, 2_000);

    console.log(`[web-perf] deal ${JSON.stringify(deal)}`);
    console.log(`[web-perf] idle ${JSON.stringify(idle)}`);
    expectSkia(idle, "the settled table");

    // The only assertions are anti-vacuity ones. A threshold here would be the
    // flaky gate this was explicitly not to become — the numbers above are the
    // deliverable, compared by hand against docs/WEB-PERF.md.
    expect(deal.frames, "no frames were observed, so nothing was measured").toBeGreaterThan(30);
    expect(idle.frames, "no frames were observed on the settled table").toBeGreaterThan(20);
    expect(deal.domNodes, "the table never rendered").toBeGreaterThan(100);
  });

  // The deal is a burst the player watches; a drag is a burst the player's own
  // finger drives, and the only one where a dropped frame lands under the thumb
  // that caused it. It is also the one place the gesture crosses to the JS
  // thread while it runs, so it is where a hop that fires per frame shows up.
  test("records a drag across the hand fan", async ({ page, baseURL }) => {
    test.setTimeout(3 * 60_000);

    // A real landscape phone, the orientation the game locks to.
    await page.setViewportSize({ width: 844, height: 390 });
    await openSeededGame(page, baseURL!, 4);
    await page.locator(TABLE).waitFor({ timeout: 60_000 });
    await page.waitForTimeout(1_500);
    await skiaFelt(page);

    const cards = await page.locator(HAND_CARDS).all();
    const boxes = (await Promise.all(cards.map((c) => c.boundingBox())))
      .filter((b): b is NonNullable<typeof b> => b !== null)
      .sort((a, b) => a.x - b.x);
    expect(boxes.length, "the seeded hand rendered no cards").toBeGreaterThan(4);

    const labelsNow = async () => {
      const found = await page.locator(HAND_CARDS).all();
      const withX = await Promise.all(
        found.map(async (c) => ({
          label: await c.getAttribute("aria-label"),
          box: await c.boundingBox(),
        }))
      );
      return withX
        .filter((c) => c.label !== null && c.box !== null)
        .sort((a, b) => a.box!.x - b.box!.x)
        .map((c) => c.label!);
    };

    const before = await labelsNow();
    const first = boxes[0]!;
    const last = boxes[boxes.length - 1]!;
    const fromX = first.x + first.width / 2;
    const toX = last.x + last.width;
    const y = first.y + first.height / 2;

    // The hold is a stationary finger, so it is spent BEFORE the recorder
    // starts: 800ms of pointer-down inside the window would be 800ms of idle
    // table averaged into the drag's own p50.
    await page.mouse.move(fromX, y);
    await page.mouse.down();
    await page.waitForTimeout(PAST_HOLD_MS);

    // `mouse.move(..., { steps: n })` dispatches every step back to back, so the
    // whole traversal lands in tens of milliseconds and the window it was meant
    // to fill stays idle. A finger arrives about once a frame; this paces the
    // moves to match, so the recorded frames are frames the gesture had to
    // answer.
    const STEP_MS = 16;
    const STEPS = 90;
    const recording = record(page, STEP_MS * STEPS);
    for (let i = 1; i <= STEPS; i++) {
      await page.mouse.move(fromX + ((toX - fromX) * i) / STEPS, y);
      await page.waitForTimeout(STEP_MS);
    }
    const drag = await recording;
    await page.mouse.up();
    await page.waitForTimeout(500);

    console.log(`[web-perf] drag ${JSON.stringify(drag)}`);

    // A number labelled `drag` that no drag produced is worse than no number:
    // every threshold below is satisfied by a table nobody touched.
    const after = await labelsNow();
    expect(after, "the hand lost or gained a card during the drag").toHaveLength(before.length);
    expect(
      after,
      `the pointer went down and up without moving a card, so the recording above is of an idle table: ${after.join(", ")}`
    ).not.toEqual(before);
    expect(drag.frames, "no frames were observed during the drag").toBeGreaterThan(20);
    expectSkia(drag, "the drag");
    expect(drag.domNodes, "the table never rendered").toBeGreaterThan(100);
  });

  // The phone's CPU is the budget a desktop run hides: the same table that holds 60fps at 1x
  // is a fraction of that at 4x, and the owner plays it on the phone.
  test("records a settled table and a turn at phone speed", async ({ page, baseURL }) => {
    test.setTimeout(3 * 60_000);

    await page.setViewportSize(PHONE_VIEWPORT);
    await openApp(page, baseURL!);
    await throttleCpu(page, PHONE_CPU_RATE);
    await startOfflineGame(page, { playerCount: 4, gameMode: "free_for_all" });
    await page.locator(TABLE).waitFor({ timeout: 120_000 });
    await waitForViewerTurn(page);
    await skiaFelt(page);
    const settled4x = await record(page, 4_000);

    console.log(`[web-perf] idle-4x ${JSON.stringify(settled4x)}`);
    expect(settled4x.frames, "no frames were observed on the throttled table").toBeGreaterThan(5);
    expect(settled4x.domNodes, "the table never rendered").toBeGreaterThan(100);
    expectSkia(settled4x, "the settled table");

    // The viewer's own move, a single or else a pass: the throw and its landing, the lamp's glide
    // and the bots' turn behind it. Picked at full speed: the picker's one-second wait for GIOCA
    // runs out on a slow table.
    await throttleCpu(page, 1);
    if ((await playAnyLegal(page)) === null) await page.getByRole("button", { name: "Passa il turno" }).click();
    await throttleCpu(page, PHONE_CPU_RATE);
    const turn4x = await record(page, 2_500);
    console.log(`[web-perf] turn-4x ${JSON.stringify(turn4x)}`);
    expect(turn4x.frames, "no frames were observed through the turn").toBeGreaterThan(5);
    expectSkia(turn4x, "the turn");
  });

  // One round from the click to the result, the recorder running throughout: the deal, every
  // throw, the bots' replies and the settle between them, which no fixed window covers.
  // `transformed` and `domNodes` are sampled at its end, on the result screen.
  test("records a full round at phone speed", async ({ page, baseURL }) => {
    test.setTimeout(15 * 60_000);

    await page.setViewportSize(PHONE_VIEWPORT);
    await openApp(page, baseURL!);
    await throttleCpu(page, PHONE_CPU_RATE);
    await startOfflineGame(page, { playerCount: 4, gameMode: "free_for_all", format: "single" });
    const recording = await startRecording(page);
    await driveGameToCompletion(page, {
      isFinished: (p) => p.getByTestId("btn-home").isVisible(),
      maxTotalMs: 12 * 60_000,
      stallMs: 60_000,
    });
    const round = await recording.stop();

    console.log(`[web-perf] round-4x ${JSON.stringify(round)}`);
    expect(round.frames, "no frames were observed through the round").toBeGreaterThan(100);
  });

  test("records a settled online table", async ({ browser, baseURL }) => {
    test.setTimeout(3 * 60_000);
    const table = await openOnlineTable(browser, baseURL!, {
      playerCount: 2,
      gameMode: "free_for_all",
      viewport: { width: 844, height: 390 },
      deviceScaleFactor: 3,
      motion: true,
    });
    try {
      await table.page.waitForTimeout(2_000);
      const onlineIdle = await record(table.page, 2_000);
      console.log(`[web-perf] online-idle ${JSON.stringify(onlineIdle)}`);
      expect(onlineIdle.frames, "no frames were observed on the online table").toBeGreaterThan(20);
      expect(onlineIdle.domNodes, "the table never rendered").toBeGreaterThan(100);
    } finally {
      await table.close();
    }
  });

  // Lighthouse's mobile preset: 4x CPU, 150ms RTT, 1.6 Mbps down, 750 kbps up.
  test("records first load on a throttled phone", async ({ page, baseURL }) => {
    test.setTimeout(3 * 60_000);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 150,
      downloadThroughput: (1_600 * 1024) / 8,
      uploadThroughput: (750 * 1024) / 8,
    });
    await page.addInitScript(() => {
      const seen = { lcp: 0, blocking: 0 };
      (window as unknown as { __load: typeof seen }).__load = seen;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) seen.lcp = entry.startTime;
      }).observe({ type: "largest-contentful-paint", buffered: true });
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) seen.blocking += Math.max(0, entry.duration - 50);
      }).observe({ type: "longtask", buffered: true });
    });

    await openApp(page, baseURL!);
    await page.waitForTimeout(3_000);
    const load = await page.evaluate(() => {
      const seen = (window as unknown as { __load: { lcp: number; blocking: number } }).__load;
      const fcp = performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? 0;
      return { fcp: +fcp.toFixed(0), lcp: +seen.lcp.toFixed(0), tbt: +seen.blocking.toFixed(0) };
    });
    console.log(`[web-perf] throttled-load ${JSON.stringify(load)}`);

    expect(load.lcp, "no largest-contentful-paint was observed").toBeGreaterThan(0);
  });
});
