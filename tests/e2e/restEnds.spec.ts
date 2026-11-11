// tests/e2e/restEnds.spec.ts — a table at rest carries its sway on the compositor (rule 51): the opacity of the
// end-B layer, a CSS animation baked from the rig's own state, stays within half a point of the lamp the rig moves
// and of the light `lib/swayTable.ts` bakes from that state, and the rig's lamp within the stepping error of the
// same table, on the virtual clock.
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { heldTurnTable } from "./helpers/mockupParity";
import { installVirtualClock, stepThen, stepUntil } from "./helpers/virtualClock";
import { STEP_MS } from "./helpers/traceDiff";
import { HAND_CARD_BOXES } from "./helpers/selectors";
import { bakeSway, speedOf, TRACK_SECONDS, TRACK_STEP, trackAt } from "../../lib/swayTable";
import { END_B_LEAN, END_B_SAMPLE, type EndBLean, type EndBSample, SWAY_PT, swayOfOpacity, swayShows } from "./helpers/renderCounters";

const VIEWPORT = { width: 874, height: 402 };
const SEED = 1255;
/** The most the baked light may be off the rig's (RESULT.md Q3). */
const HANDOFF_PT = 0.5;
/** Past one whole swing at its slowest, 9.3 s, so the rig is seen through both its extremes. */
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
  return { clock: f.lamp.clock, t0: Number(canvas.dataset.trackT), at: timing ? (timing.progress * timing.duration) / 1000 : null, lx: f.lamp.x, ph: f.lamp.ph, o:Number(getComputedStyle(layer).opacity), playing: layer.getAnimations().filter((a) => a.playState === "running" || a.playState === "paused").length };
})()`;

interface Sample {
  /** The rig's clock, the clock it was when the track was baked, and where the animation is in its pass, in seconds. */
  clock: number;
  t0: number;
  at: number | null;
  lx: number;
  ph: number;
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

/** The share of the table's smallest allowance the rig's centre may move by in the window: a glide or kick still running would move it more. */
const CENTRE_SHARE = 0.1;
/** Seconds apart `swayBounds` reads the speed's top, slope and bend. */
const GRID = 0.01;

/** The sway, -1 to 1, `lib/swayTable.ts` bakes from the rig's state at `from`, at a sample's clock. The clock steps the animations before the frame's timers, so a read after a step has the layer and the rig both at the frame's end. */
function tableFrom(from: Sample): (s: Sample) => number {
  const track = bakeSway({ ph: from.ph, t: from.clock }, TRACK_SECONDS);
  return (s) => trackAt(track, s.clock - from.clock);
}

/**
 * How far, -1 to 1, the rig's sway may lie off the table baked at `samples[0]`, at each sample, one rig step apart. The rig
 * adds `dt * speedOf(t)` at the step's end, which runs ahead of the integral `bakeSway` carries by `dt / 2` times the step's
 * change of speed, to within a trapezoid's `dt^3 / 12` of its bend; a track, linear between stops, is off a sine by
 * `TRACK_STEP^2 / 8` of its curvature. `TRACK_VS_EULER` is measured at 60 Hz from fixed settles, not at this clock's step from
 * this start, so it is no bound here.
 */
function swayBounds(samples: Sample[]): number[] {
  const t0 = samples[0]!.clock;
  let [top, slope, bend] = [0, 0, 0];
  for (let t = t0; t <= samples.at(-1)!.clock + TRACK_STEP; t += GRID) {
    top = Math.max(top, speedOf(t));
    slope = Math.max(slope, Math.abs(speedOf(t + GRID) - speedOf(t)) / GRID);
    bend = Math.max(bend, Math.abs(speedOf(t + GRID) - 2 * speedOf(t) + speedOf(t - GRID)) / GRID ** 2);
  }
  const between = (TRACK_STEP ** 2 / 8) * (top ** 2 + slope);
  let [ahead, trapezoid] = [0, 0];
  return samples.map((s, k) => {
    if (k > 0) {
      const last = samples[k - 1]!.clock;
      const dt = s.clock - last;
      ahead += (dt / 2) * (speedOf(s.clock) - speedOf(last));
      trapezoid += (dt ** 3 / 12) * bend;
    }
    return Math.abs(ahead) + trapezoid + between;
  });
}

test("the end-B layer's opacity follows the lamp's light to within half a point", async ({ browser, baseURL }) => {
  test.setTimeout(3 * 60_000);
  const { page, context, shown } = await restedTable(browser, baseURL!);
  // The rig steps after the seek in the frame the layer shows, so the animation is a frame behind its clock, never more.
  expect((Math.abs(shown.at! - (shown.clock - shown.t0)) * 1000) / STEP_MS, "frames the animation is from the rig's place the frame its layer first shows").toBeLessThan(1.5);
  const samples = [shown, ...(await sampled(page, WINDOW - 1))];
  expect(Math.min(...samples.map((s) => s.playing)), "frames the end-B layer had no playing animation").toBeGreaterThanOrEqual(1);

  const layer = [await stepThen<EndBSample | null>(page, 60 * STEP_MS, END_B_SAMPLE), await stepThen<EndBSample | null>(page, 60 * STEP_MS, END_B_SAMPLE), await stepThen<EndBSample | null>(page, 60 * STEP_MS, END_B_SAMPLE)];
  const picture = await page.evaluate<EndBLean | null>(END_B_LEAN);
  console.log(`end B's picture: ${JSON.stringify(picture)}`);
  expect(swayShows(layer, picture), "end B is not a picture lit from the far end of the sway, or its layer does not sway").toBe(true);

  const lows = samples.map((s) => s.lx);
  expect((Math.max(...lows) - Math.min(...lows)) / 2, "the swing the rig made").toBeGreaterThan(SWAY_PT - 1);

  const steps = samples.slice(1).map((s, i) => s.clock - samples[i]!.clock);
  expect(Math.max(...steps.map((dt) => Math.abs(dt * 1000 - STEP_MS))), "milliseconds a frame's rig step is off the clock's step").toBeLessThan(1e-6);
  const sway = tableFrom(shown);
  const bounds = swayBounds(samples);
  const centres = samples.map((s) => s.lx - SWAY_PT * Math.sin(s.ph));
  const centre = centres.reduce((sum, c) => sum + c, 0) / centres.length;
  const moved = Math.max(...centres.map((c) => Math.abs(c - centre)));
  const rig = samples.map((s) => Math.abs(s.lx - centre - SWAY_PT * sway(s)));
  const allowed = bounds.map((b) => SWAY_PT * b * (1 + CENTRE_SHARE));
  const worst = rig.reduce((w, r, i) => (r - allowed[i]! > rig[w]! - allowed[w]! ? i : w), 0);
  const light = Math.max(...samples.map((s) => SWAY_PT * Math.abs(swayOfOpacity(s.o) - sway(s))));
  const toRig = Math.max(...samples.map((s) => Math.abs(s.lx - centre - SWAY_PT * swayOfOpacity(s.o))));
  console.log(
    `over ${WINDOW} frames the rig's centre moves ${moved.toExponential(1)} pt, under ${(CENTRE_SHARE * SWAY_PT * Math.min(...bounds)).toExponential(1)}; its lamp is ${rig[worst]!.toFixed(3)} pt off the keyframe table where ${allowed[worst]!.toFixed(3)} pt is allowed (at most ${Math.max(...rig).toFixed(3)} pt); the end-B layer's light is at most ${light.toFixed(3)} pt off the table and ${toRig.toFixed(3)} pt off the rig's`,
  );
  expect(moved, "points the rig's centre moves while it only sways: a glide or kick is still running, or its swing is not SWAY_PT").toBeLessThan(CENTRE_SHARE * SWAY_PT * Math.min(...bounds));
  expect(rig[worst]! - allowed[worst]!, "points the rig's lamp is past the keyframe table's stepping error").toBeLessThan(0);
  expect(light, "points the end-B layer's light is off the keyframe table's").toBeLessThan(HANDOFF_PT);
  expect(toRig, "points the end-B layer's light is off the rig's").toBeLessThan(HANDOFF_PT);
  await context.close();
});

test("a rig that stalls behind its animation is caught up with, and the light is back within half a point", async ({ browser, baseURL }) => {
  test.setTimeout(3 * 60_000);
  const { page, context, shown } = await restedTable(browser, baseURL!);
  await sampled(page, WINDOW);
  // The animation runs on while the rig, as a stalled page's does, does not: 300 ms is 6 pt of sway.
  await page.evaluate((ms) => window.murlanStepAnimations(ms), STALL_MS);
  const after = await sampled(page, STALL_FRAMES);
  const sway = tableFrom(shown);
  const off = after.map((s) => SWAY_PT * Math.abs(swayOfOpacity(s.o) - sway(s)));
  expect(Math.max(...off.slice(0, 5)), "points the stall put the light off the keyframe table's").toBeGreaterThan(HANDOFF_PT);
  expect(Math.max(...off.slice(-60)), "points the light is still off the keyframe table's a second after the stall").toBeLessThan(HANDOFF_PT);
  await context.close();
});
