// tests/e2e/restEnds.spec.ts — a table at rest carries its sway on the compositor (rule 51): the opacity of the
// end-B layer, a CSS animation baked from the rig's own state, stays within half a point of the lamp the rig
// moves, on the virtual clock.
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { heldTurnTable } from "./helpers/mockupParity";
import { installVirtualClock, stepThen, stepUntil } from "./helpers/virtualClock";
import { STEP_MS } from "./helpers/traceDiff";
import { HAND_CARD_BOXES } from "./helpers/selectors";
import { SWAY } from "../../components/table/lampRig";
import { END_B_LEAN, END_B_SAMPLE, type EndBLean, type EndBSample, swayShows } from "./helpers/renderCounters";

const VIEWPORT = { width: 874, height: 402 };
const SEED = 1255;
/** The most the baked light may be off the rig's (RESULT.md Q3). */
const HANDOFF_PT = 0.5;
/** Past one whole swing at its slowest, 9.3 s, so the track's centre is read off its two extremes. */
const WINDOW = 640;
/** Milliseconds the animation is stepped ahead of the rig, and the frames watched after: past two checks of `DRIFT_CHECK_MS`, and a second more. */
const STALL_MS = 300;
const STALL_FRAMES = 150;

const END = '[data-testid="felt-end-b"]';
const READ = `(() => {
  const canvas = document.querySelector('${END}');
  const f = window.murlanTrace.frames.at(-1);
  if (!canvas || canvas.style.visibility !== "visible" || !f) return null;
  const layer = canvas.parentElement;
  const timing = layer.getAnimations()[0]?.effect?.getComputedTiming();
  return { clock: f.lamp.clock, t0: Number(canvas.dataset.trackT), at: timing ? (timing.progress * timing.duration) / 1000 : null, lx: f.lamp.x, o: Number(getComputedStyle(layer).opacity), playing: layer.getAnimations().filter((a) => a.playState === "running" || a.playState === "paused").length };
})()`;

interface Sample {
  /** The rig's clock, the clock it was when the track was baked, and where the animation is in its pass, in seconds. */
  clock: number;
  t0: number;
  at: number | null;
  lx: number;
  o: number;
  playing: number;
}

async function restedTable(browser: Browser, baseURL: string): Promise<{ page: Page; context: BrowserContext; shown: Sample }> {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, locale: "it-IT", baseURL });
  const page = await context.newPage();
  await installVirtualClock(page, SEED);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await heldTurnTable(page, baseURL);
  await stepUntil(page, () => page.locator(HAND_CARD_BOXES).first().isVisible(), "the viewer's hand");
  await page.evaluate(() => (window as unknown as { murlanTrace: { start(): void } }).murlanTrace.start());
  // One frame at a time, so the frame the layer first shows is the first sample. A chunk of frames steps the animations its whole length before the rig's frames, which skews the two by up to 2.4 pt for the next few frames, so the light would be measured against a harness artifact.
  const deadline = Date.now() + 120_000;
  for (;;) {
    const shown = await stepThen<Sample | null>(page, STEP_MS, READ);
    if (shown) return { page, context, shown };
    if (Date.now() > deadline) throw new Error("the table resting on its two ends: not shown after 120000 ms");
  }
}

async function sampled(page: Page, frames: number): Promise<Sample[]> {
  const samples: Sample[] = [];
  for (let i = 0; i < frames; i++) {
    const s = await stepThen<Sample | null>(page, STEP_MS, READ);
    expect(s, "the table left its two ends while it only swayed").not.toBeNull();
    samples.push(s!);
  }
  return samples;
}

const centreOf = (samples: Sample[]) => (Math.max(...samples.map((s) => s.lx)) + Math.min(...samples.map((s) => s.lx))) / 2;

/** The clock steps the animations before the frame's timers, so a read after a step has both at the frame's end. */
const offBy = (samples: Sample[], centre: number) => samples.map((s) => Math.abs(s.lx - centre - SWAY * (2 * s.o - 1)));

test("the end-B layer's opacity follows the lamp's light to within half a point", async ({ browser, baseURL }) => {
  test.setTimeout(3 * 60_000);
  const { page, context, shown } = await restedTable(browser, baseURL!);
  // The rig steps after the seek in the frame the layer shows, so the animation is a frame behind its clock, never more.
  expect(Math.abs(shown.at! - (shown.clock - shown.t0)), "seconds the animation is from the rig's place the frame its layer first shows").toBeLessThan((1.5 * STEP_MS) / 1000);
  const samples = [shown, ...(await sampled(page, WINDOW - 1))];
  expect(Math.min(...samples.map((s) => s.playing)), "frames the end-B layer had no playing animation").toBeGreaterThanOrEqual(1);

  const layer = [await stepThen<EndBSample | null>(page, 60 * STEP_MS, END_B_SAMPLE), await stepThen<EndBSample | null>(page, 60 * STEP_MS, END_B_SAMPLE), await stepThen<EndBSample | null>(page, 60 * STEP_MS, END_B_SAMPLE)];
  const picture = await page.evaluate<EndBLean | null>(END_B_LEAN);
  console.log(`end B's picture: ${JSON.stringify(picture)}`);
  expect(swayShows(layer, picture), "end B is not a picture lit from the far end of the sway, or its layer does not sway").toBe(true);

  const lows = samples.map((s) => s.lx);
  expect((Math.max(...lows) - Math.min(...lows)) / 2, "the swing the rig made").toBeGreaterThan(SWAY - 1);
  const worst = Math.max(...offBy(samples, centreOf(samples)));
  console.log(`the baked light is at most ${worst.toFixed(3)} pt off the rig's over ${WINDOW} frames`);
  expect(worst, "points the end-B layer's light is off the rig's").toBeLessThan(HANDOFF_PT);
  await context.close();
});

test("a rig that stalls behind its animation is caught up with, and the light is back within half a point", async ({ browser, baseURL }) => {
  test.setTimeout(3 * 60_000);
  const { page, context } = await restedTable(browser, baseURL!);
  const centre = centreOf(await sampled(page, WINDOW));
  // The animation runs on while the rig, as a stalled page's does, does not: 300 ms is 6 pt of sway.
  await page.evaluate((ms) => window.murlanStepAnimations(ms), STALL_MS);
  const after = await sampled(page, STALL_FRAMES);
  const off = offBy(after, centre);
  expect(Math.max(...off.slice(0, 5)), "points the stall put the light off the rig's").toBeGreaterThan(HANDOFF_PT);
  expect(Math.max(...off.slice(-60)), "points the light is still off the rig's a second after the stall").toBeLessThan(HANDOFF_PT);
  await context.close();
});
