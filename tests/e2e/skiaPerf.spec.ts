// tests/e2e/skiaPerf.spec.ts — what the Skia table costs a frame at a phone's CPU, held to
// tests/e2e/helpers/skiaPerfBudgets.ts (RULES.md 51). Counted per stepped frame on the virtual
// clock, so a slow runner cannot pass by drawing fewer frames.
import type { CDPSession, Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { botMove, heldTurnTable, playLowest } from "./helpers/mockupParity";
import { installVirtualClock, stepThen, stepUntil } from "./helpers/virtualClock";
import { STEP_MS } from "./helpers/traceDiff";
import { COUNTED, countRenders, END_B_SAMPLE, type EndBSample, startRenderCounts, swayShows, TAKE_RENDER_COUNTS, type RenderCounts } from "./helpers/renderCounters";
import { HAND_CARD_BOXES } from "./helpers/selectors";
import { BUDGETS, type WindowBudget } from "./helpers/skiaPerfBudgets";
import type { TraceFrame } from "../../lib/e2eTrace";

const VIEWPORT = { width: 874, height: 402 };
const SEED = 1255;
/** Lighthouse's mobile CPU preset. */
const PHONE_CPU_RATE = 4;
const SETTLE = 120;
const WINDOW = 240;
/** By frame of the turn's window: the three bots answer the viewer's throw, and the lamp glides to each. */
const BOT_MOVES = [60, 120, 180];
/** The lamp's glide redraws the felt nearly every frame between moves; fewer and the bots never moved. */
const TURN_FELT_FLOOR = 0.8;
/** Of the turn's card style budget: the hand and the throws restyle the cards; fewer and the turn never played. */
const TURN_CARD_STYLE_FLOOR = 0.5;

interface Measured {
  frames: number;
  feltFrames: number;
  /** The settled felt's end-B layer ran an animation and its opacity moved across the window. */
  swayShown: boolean;
  glDrawsPerFrame: number;
  canvas2dDraws: number;
  offscreenDraws: number;
  readPixels: number;
  styleWrites: number;
  cardStyles: number;
  scriptMsPerFrame: number;
  taskMsPerFrame: number;
  longTasks: number;
  felts: TraceFrame["felt"][];
}

async function metrics(cdp: CDPSession) {
  const { metrics: all } = await cdp.send("Performance.getMetrics");
  const of = (name: string) => all.find((m) => m.name === name)?.value ?? 0;
  return { task: of("TaskDuration") * 1000, script: of("ScriptDuration") * 1000 };
}

async function measure(page: Page, cdp: CDPSession, at: Record<number, (page: Page) => Promise<void>> = {}): Promise<Measured> {
  await page.evaluate(() => {
    const w = window as unknown as { murlanLongTasks: number; murlanLongTaskObserver?: PerformanceObserver; murlanTrace: { frames: unknown[] } };
    w.murlanLongTasks = 0;
    w.murlanTrace.frames.length = 0;
    w.murlanLongTaskObserver?.disconnect();
    w.murlanLongTaskObserver = new PerformanceObserver((list) => (w.murlanLongTasks += list.getEntries().length));
    w.murlanLongTaskObserver.observe({ type: "longtask" });
  });
  await stepThen(page, null, TAKE_RENDER_COUNTS);
  const from = await metrics(cdp);
  const frames: RenderCounts[] = [];
  const sway: (EndBSample | null)[] = [];
  for (let i = 1; i <= WINDOW; i++) {
    frames.push(await stepThen<RenderCounts>(page, STEP_MS, TAKE_RENDER_COUNTS));
    if (i === 1 || i === 60 || i === 120) sway.push(await page.evaluate<EndBSample | null>(END_B_SAMPLE));
    await at[i]?.(page);
  }
  const to = await metrics(cdp);
  const { longTasks, felts } = await page.evaluate(() => {
    const w = window as unknown as { murlanLongTasks: number; murlanTrace: { frames: TraceFrame[] } };
    return { longTasks: w.murlanLongTasks, felts: [...new Set(w.murlanTrace.frames.map((f) => f.felt))] };
  });
  const sum = (of: (f: RenderCounts) => number) => frames.reduce((s, f) => s + of(f), 0);
  const drawn = (kind: string) => sum((f) => Object.entries(f.draws).reduce((t, [k, v]) => t + (k.endsWith(kind) ? v : 0), 0));
  const per = (x: number) => +(x / WINDOW).toFixed(2);
  return {
    frames: frames.reduce((s, f) => s + f.frames, 0),
    swayShown: swayShows(sway),
    feltFrames: frames.filter((f) => (f.drewIn[COUNTED.felt] ?? 0) > 0).length,
    glDrawsPerFrame: per(drawn(" webgl")),
    canvas2dDraws: drawn(" 2d"),
    offscreenDraws: sum((f) => f.draws.offscreen ?? 0),
    readPixels: sum((f) => f.readPixels),
    styleWrites: sum((f) => Object.values(f.styles).reduce((t, v) => t + v, 0)),
    cardStyles: sum((f) => f.styles.cards ?? 0),
    scriptMsPerFrame: per(to.script - from.script),
    taskMsPerFrame: per(to.task - from.task),
    longTasks,
    felts,
  };
}

function holds(m: Measured, budget: WindowBudget, what: string) {
  expect.soft(m.frames, `frames the counter saw through ${what}`).toBe(WINDOW);
  expect.soft(m.felts, `the felts the trace saw through ${what}`).toEqual(["skia"]);
  // The sway rides the compositor, so the floor is its layer showing, not canvas redraws: docs/adr/0020-the-table-at-rest-plays-precomputed-tracks.md
  expect.soft(m.feltFrames > 0 || m.swayShown, `the felt never drew, and no end-B layer swayed, through ${what}`).toBe(true);
  expect.soft(m.glDrawsPerFrame, `WebGL draws a frame through ${what}`).toBeLessThanOrEqual(budget.glDrawsPerFrame);
  expect.soft(m.canvas2dDraws, `2D canvas draws through ${what}`).toBeLessThanOrEqual(budget.canvas2dDraws);
  expect.soft(m.offscreenDraws, `offscreen draws through ${what}`).toBeLessThanOrEqual(budget.offscreenDraws);
  expect.soft(m.readPixels, `readPixels through ${what}`).toBeLessThanOrEqual(budget.readPixels);
  expect.soft(m.styleWrites, `style writes through ${what}`).toBeLessThanOrEqual(budget.styleWrites);
  if (budget.cardStyles !== undefined) expect.soft(m.cardStyles, `style writes inside cards through ${what}`).toBeLessThanOrEqual(budget.cardStyles);
  if (budget.feltFrames !== undefined) expect.soft(m.feltFrames, `frames the felt drew through ${what}`).toBeLessThanOrEqual(budget.feltFrames);
}

test("the Skia table at a phone's CPU stays inside its budgets, at rest and through a turn", async ({ browser, baseURL }, info) => {
  test.setTimeout(4 * 60_000);
  // DPR 1: at 3 this rasteriser takes over six minutes for the rest window alone.
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, locale: "it-IT", baseURL });
  const page = await context.newPage();
  await installVirtualClock(page, SEED);
  await countRenders(page);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await heldTurnTable(page, baseURL!);
  await stepUntil(page, () => page.evaluate(() => ((globalThis as { murlanShadowBuilds?: number }).murlanShadowBuilds ?? 0) > 0), "the Skia felt's shadows");
  await stepUntil(page, () => page.locator(HAND_CARD_BOXES).first().isVisible(), "the viewer's hand");
  await startRenderCounts(page);
  const cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable");
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: PHONE_CPU_RATE });
  for (let i = 0; i < SETTLE; i++) await stepThen(page, STEP_MS, TAKE_RENDER_COUNTS);

  const rest = await measure(page, cdp);
  await playLowest(1)(page);
  const turn = await measure(page, cdp, Object.fromEntries(BOT_MOVES.map((f) => [f, botMove])));
  const report = JSON.stringify({ rest, turn, budgets: BUDGETS });
  info.annotations.push({ type: "skia perf at 4x", description: report });
  console.log(`skia perf at 4x: ${report}`);
  holds(rest, BUDGETS.rest, "the settled table");
  holds(turn, BUDGETS.turn, "the turn");
  expect.soft(turn.cardStyles, "style writes inside cards while the turn played").toBeGreaterThanOrEqual(BUDGETS.turn.cardStyles * TURN_CARD_STYLE_FLOOR);
  expect.soft(turn.feltFrames, "frames the felt drew while the lamp glided to each bot").toBeGreaterThanOrEqual(WINDOW * TURN_FELT_FLOOR);
  await context.close();
});
