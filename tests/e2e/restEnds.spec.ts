// tests/e2e/restEnds.spec.ts — a table at rest carries its sway on the compositor (rule 51): the opacity of the
// end-B layer, a CSS animation baked from the rig's own state, stays within half a point of the light
// `lib/swayTable.ts` bakes from that state at the page's own clock, and of the lamp the rig moves on any frame it
// steps; a frame the rig neither steps nor may hold is a stuck rig. On the virtual clock.
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
/** Holds and wakes in a row: a frame gained or lost at each would be past half a frame by the second. */
const CYCLES = 8;
/** Frames from a wake to the rig's first step on: one arms its callback, the next runs it. */
const WAKE_FRAMES = 2;

const END = '[data-testid="felt-end-b"]';
const LAMP = "clock: f.lamp.clock, rig: f.lamp.rig, held: f.lamp.held, ends: f.lamp.ends, rested: f.lamp.rested, wall: performance.now() / 1000, lx: f.lamp.x, ph: f.lamp.ph";
const READ_RIG = `(() => { const f = window.murlanTrace.frames.at(-1); return { ${LAMP} }; })()`;
const READ = `(() => {
  const canvas = document.querySelector('${END}');
  const f = window.murlanTrace.frames.at(-1);
  if (!canvas || canvas.style.visibility !== "visible" || !f) return null;
  const layer = canvas.parentElement;
  const timing = layer.getAnimations()[0]?.effect?.getComputedTiming();
  return { ${LAMP}, t0: Number(canvas.dataset.trackT), at: timing ? (timing.progress * timing.duration) / 1000 : null, o: Number(getComputedStyle(layer).opacity), playing: layer.getAnimations().filter((a) => a.playState === "running" || a.playState === "paused").length };
})()`;

interface Sample {
  /** The drawn lamp's clock, the rig's own, which stops while it holds the lamp, the clock it was when the track was baked, and where the animation is in its pass, in seconds. */
  clock: number;
  rig: number;
  /** The rig has stopped stepping the lamp, its sway left to the layer's animation. */
  held: boolean;
  /** The end the felt shows, 0 for none, and whether the rig's own lamp has rested: a rig may hold only while both are so. */
  ends: number;
  rested: boolean;
  /** The page's `performance.now()`, in seconds. */
  wall: number;
  t0: number;
  at: number | null;
  lx: number;
  ph: number;
  o: number;
  playing: number;
}

type Rig = Pick<Sample, "clock" | "rig" | "held" | "ends" | "rested" | "wall" | "lx" | "ph">;

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

/** Points a rested lamp's centre may move by: `isRested`'s glide residual and its kick's swing, the harness's own copy. */
const REST_PT = 0.25 + 0.1;
/** Seconds apart `swayBounds` reads the speed's top, slope and bend. */
const GRID = 0.01;

/**
 * The rig's clock at a sample as the page's clock has it from `from`, the frame the layer shows, when the rig still steps: the rig
 * may stop stepping only once an end shows. Read from the page, never from the rig, so a held rig is measured, not believed.
 */
function clockFrom(from: Pick<Sample, "clock" | "wall">): (s: Pick<Sample, "wall">) => number {
  return (s) => from.clock + (s.wall - from.wall);
}

/** The sway, -1 to 1, `lib/swayTable.ts` bakes from the rig's state at `from`, at a sample's `clockFrom`. After `from`, the clock steps the animations before the frame's timers, so a read after a step has the layer and the rig both at the frame's end; at `from` itself the animation is a frame behind. */
function tableFrom(from: Pick<Sample, "clock" | "wall" | "ph">): (s: Pick<Sample, "wall">) => number {
  const track = bakeSway({ ph: from.ph, t: from.clock }, TRACK_SECONDS);
  const clock = clockFrom(from);
  return (s) => trackAt(track, clock(s) - from.clock);
}

/**
 * Frames the rig neither stepped with the page's clock nor held while it may: a rig left stopped by a wake that never came. A woken
 * rig's callback runs from the frame after the wake, so a frame off the page's clock is stuck unless the next one is back on it.
 */
function stuck(from: Pick<Sample, "clock" | "wall">, samples: Pick<Sample, "rig" | "held" | "ends" | "rested" | "wall">[]): number {
  const off = (s: Pick<Sample, "rig" | "held" | "wall">) => !s.held && Math.abs(s.rig - (from.clock + s.wall - from.wall)) * 1000 > 1e-3;
  return samples.filter((s, i) => (s.held ? s.ends === 0 || !s.rested : off(s) && (i === samples.length - 1 || off(samples[i + 1]!)))).length;
}

/** The drawn lamp's centre, `lx` less its sway, at each sample, their mean, and the most one lies off it. */
function centred(samples: Pick<Sample, "lx" | "ph">[]): { centres: number[]; centre: number; moved: number } {
  const centres = samples.map((s) => s.lx - SWAY_PT * Math.sin(s.ph));
  const centre = centres.reduce((sum, c) => sum + c, 0) / centres.length;
  return { centres, centre, moved: Math.max(...centres.map((c) => Math.abs(c - centre))) };
}

/**
 * How far, -1 to 1, the rig's sway may lie off the table baked at `samples[0]`, at each frame, its steps counted by its clock. Over a run
 * of steps the rig adds `dt * speedOf(t)` at each step's end, which runs ahead of the integral `bakeSway` carries by `dt / 2`
 * times the change of speed over the run, to within a trapezoid's `dt^3 / 12` of its bend a step, and a step cut short by a
 * wake by `dt^2 / 2` of its slope; a held rig is carried on that integral, so adds nothing. A track, linear between stops, is off
 * a sine by `TRACK_STEP^2 / 8` of its curvature. `TRACK_VS_EULER` is measured at 60 Hz from fixed settles, not at this clock's
 * step from this start, so it is no bound here.
 */
function swayBounds(t0: number, samples: Pick<Sample, "clock" | "held">[]): number[] {
  let [top, slope, bend] = [0, 0, 0];
  for (let t = t0; t <= samples.at(-1)!.clock + TRACK_STEP; t += GRID) {
    top = Math.max(top, speedOf(t));
    slope = Math.max(slope, Math.abs(speedOf(t + GRID) - speedOf(t)) / GRID);
    bend = Math.max(bend, Math.abs(speedOf(t + GRID) - 2 * speedOf(t) + speedOf(t - GRID)) / GRID ** 2);
  }
  const between = (TRACK_STEP ** 2 / 8) * (top ** 2 + slope);
  const dt = STEP_MS / 1000;
  const run = (a: number, b: number, n: number) => Math.abs((dt / 2) * (speedOf(b) - speedOf(a))) + ((n * dt ** 3) / 12) * bend;
  let [closed, start, steps] = [0, t0, 0];
  return samples.map((s, k) => {
    const prev = samples[k - 1];
    if (prev && !s.held) {
      if (prev.held) [closed, start, steps] = [closed + (dt ** 2 / 2) * slope, prev.clock, 0];
      steps += Math.round((s.clock - prev.clock) / dt);
    } else if (prev && steps > 0) [closed, steps] = [closed + run(start, prev.clock, steps), 0];
    return closed + (steps > 0 ? run(start, s.clock, steps) : 0) + between;
  });
}

/** The drawn lamp against the table baked at `from`, at the lamp's own clock, about its centre: the worst sample's distance, its allowance and their difference. */
function offTable(from: Rig, samples: Rig[]): { centre: number; moved: number; off: number; allowed: number; excess: number } {
  const track = bakeSway({ ph: from.ph, t: from.clock }, TRACK_SECONDS);
  const { centres, centre, moved } = centred(samples);
  const allowed = swayBounds(from.clock, samples).map((b, k) => SWAY_PT * b + Math.abs(centres[k]! - centre));
  const excess = samples.map((s, k) => Math.abs(s.lx - centre - SWAY_PT * trackAt(track, s.clock - from.clock)) - allowed[k]!);
  const worst = excess.indexOf(Math.max(...excess));
  return { centre, moved, off: excess[worst]! + allowed[worst]!, allowed: allowed[worst]!, excess: excess[worst]! };
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

  const sway = tableFrom(shown);
  const steady = samples.slice(1);
  const lights = steady.map((s) => SWAY_PT * swayOfOpacity(s.o));
  expect((Math.max(...lights) - Math.min(...lights)) / 2, "the swing the end-B layer made").toBeGreaterThan(SWAY_PT - 1);
  expect(stuck(shown, steady), "frames the rig neither stepped with the page's clock nor held the lamp").toBe(0);
  const clock = clockFrom(shown);
  expect(Math.max(...steady.map((s) => Math.abs(s.clock - clock(s)))) * 1000, "milliseconds the drawn lamp's clock is off the page's").toBeLessThan(1e-3);

  const held = samples.filter((s) => s.held).length;
  const { centre, moved, off, allowed, excess } = offTable(shown, samples);
  const light = Math.max(...steady.map((s) => SWAY_PT * Math.abs(swayOfOpacity(s.o) - sway(s))));
  const toRig = Math.max(...steady.map((s) => Math.abs(s.lx - centre - SWAY_PT * swayOfOpacity(s.o))));
  console.log(
    `over ${WINDOW} frames the rig held the lamp ${held} and stepped it ${WINDOW - held}; the drawn lamp's centre moves ${moved.toExponential(1)} pt, under ${REST_PT} pt, and the lamp is ${off.toFixed(3)} pt off the keyframe table where ${allowed.toFixed(3)} pt is allowed; after the frame it shows, the end-B layer's light is at most ${light.toFixed(3)} pt off the table and ${toRig.toFixed(3)} pt off the drawn lamp's`,
  );
  expect(moved, "points the rig's centre moves while it only sways: more than a rested lamp's, so a glide or kick is still running or its swing is not SWAY_PT").toBeLessThan(REST_PT);
  expect(excess, "points the rig's lamp is past the keyframe table's stepping error and its centre's motion").toBeLessThan(0);
  expect(light, "points the end-B layer's light is off the keyframe table's at the page's clock").toBeLessThan(HANDOFF_PT);
  expect(toRig, "points the end-B layer's light is off the drawn lamp's").toBeLessThan(HANDOFF_PT);
  await context.close();
});

test("a held rig woken goes on from the page's clock, not from where it stopped", async ({ browser, baseURL }) => {
  test.setTimeout(3 * 60_000);
  const { page, context, shown } = await restedTable(browser, baseURL!);
  const rested = await sampled(page, WINDOW);
  expect(rested.filter((s) => s.held).length, "frames the rig held the lamp while an end showed").toBeGreaterThan(WINDOW / 2);
  expect(stuck(shown, rested), "frames the rig neither stepped with the page's clock nor held the lamp").toBe(0);
  // Any write wakes the rig; reduced motion is one a viewer can make, and the end-B layer leaves with it.
  await page.emulateMedia({ reducedMotion: "reduce" });
  let woken: Rig | null = null;
  for (let i = 0; i < 30 && !woken; i++) {
    const s = await stepThen<Rig>(page, STEP_MS, READ_RIG);
    if (!s.held) woken = s;
  }
  expect(woken, "the rig still held the lamp 30 frames after reduced motion").not.toBeNull();
  const off = (woken!.rig - (shown.clock + woken!.wall - shown.wall)) * 1000;
  console.log(`woken, the rig's clock is ${off.toFixed(3)} ms off the page's`);
  expect(Math.abs(off) / STEP_MS, "frames the woken rig's clock is off the page's").toBeLessThan(1.5);
  // A rig that stepped once under reduced motion draws no sway; one only resumed, never stepped, draws the sway it was held at.
  const after: Rig[] = [];
  for (let i = 0; i < 60; i++) after.push(await stepThen<Rig>(page, STEP_MS, READ_RIG));
  const { centre } = centred(rested);
  const drawn = Math.abs(after.at(-1)!.lx - centre);
  console.log(`woken under reduced motion, the lamp is ${drawn.toFixed(3)} pt off its centre`);
  expect(drawn, "points the woken lamp is off its centre under reduced motion: it was never stepped").toBeLessThan(REST_PT);
  expect(after.filter((s) => s.held).length, "frames a rig held the lamp under reduced motion").toBe(0);
  await context.close();
});

test("a rig that stalls behind its animation is caught up with, and the light is back within half a point", async ({ browser, baseURL }) => {
  test.setTimeout(3 * 60_000);
  const { page, context, shown } = await restedTable(browser, baseURL!);
  await page.evaluate(`(async () => { for (let i = 0; i < ${WINDOW}; i++) await globalThis.murlanStep(${STEP_MS}); })()`);
  // The animation runs on while the page's clock, and so the rig's, does not, as a stalled page's: 300 ms is 6 pt of sway.
  await page.evaluate((ms) => window.murlanStepAnimations(ms), STALL_MS);
  const after = await sampled(page, STALL_FRAMES);
  expect(stuck(shown, after), "frames the rig neither stepped with the page's clock nor held the lamp").toBe(0);
  const sway = tableFrom(shown);
  const off = after.map((s) => SWAY_PT * Math.abs(swayOfOpacity(s.o) - sway(s)));
  expect(Math.max(...off.slice(0, 5)), "points the stall put the light off the rig's").toBeGreaterThan(HANDOFF_PT);
  expect(Math.max(...off.slice(-60)), "points the light is still off the rig's a second after the stall").toBeLessThan(HANDOFF_PT);
  await context.close();
});

test("a held rig whose end leaves steps on, though nothing moved the lamp", async ({ browser, baseURL }) => {
  test.setTimeout(3 * 60_000);
  const { page, context, shown } = await restedTable(browser, baseURL!);
  let held = false;
  for (let i = 0; i < WINDOW && !held; i++) held = (await stepThen<Sample | null>(page, STEP_MS, READ))?.held ?? false;
  expect(held, `the rig never held the lamp in ${WINDOW} frames of an end shown`).toBe(true);
  // New felt content takes the end down and moves no lamp: only the end's leaving can wake the rig.
  await page.evaluate(() => (window as unknown as { murlanCardGlow(on: boolean): void }).murlanCardGlow(false));
  const after: Rig[] = [];
  for (let i = 0; i < STALL_FRAMES; i++) after.push(await stepThen<Rig>(page, STEP_MS, READ_RIG));
  expect(after.filter((s) => s.ends === 0).length, "frames the felt showed no end after its content changed").toBeGreaterThan(0);
  const woken = after.find((s) => !s.held);
  expect(woken, `the rig still held the lamp ${STALL_FRAMES} frames after its end left`).toBeDefined();
  expect((Math.abs(woken!.rig - (shown.clock + woken!.wall - shown.wall)) * 1000) / STEP_MS, "frames the woken rig's clock is off the page's").toBeLessThan(1.5);
  expect(stuck(shown, after.slice(after.indexOf(woken!))), "frames the rig neither stepped on with the page's clock from its wake nor held the lamp while an end showed").toBe(0);
  await context.close();
});

test("a rig held and woken many times keeps to the page's clock", async ({ browser, baseURL }) => {
  test.setTimeout(5 * 60_000);
  const { page, context, shown } = await restedTable(browser, baseURL!);
  const samples: Rig[] = [shown];
  const next = async () => {
    samples.push(await stepThen<Rig>(page, STEP_MS, READ_RIG));
    return samples.at(-1)!;
  };
  const offs: number[] = [];
  for (let cycle = 0; cycle < CYCLES; cycle++) {
    let s = await next();
    for (let i = 0; i < WINDOW && !s.held; i++) s = await next();
    expect(s.held, `cycle ${cycle}: the rig never held the lamp in ${WINDOW} frames`).toBe(true);
    await page.evaluate((on) => (window as unknown as { murlanCardGlow(on: boolean): void }).murlanCardGlow(on), cycle % 2 === 1);
    for (let i = 0; i < STALL_FRAMES && s.held; i++) s = await next();
    expect(s.held, `cycle ${cycle}: the rig still held the lamp ${STALL_FRAMES} frames after its end left`).toBe(false);
    for (let i = 0; i < WAKE_FRAMES; i++) s = await next();
    offs.push((s.rig - (shown.clock + s.wall - shown.wall)) * 1000);
  }
  console.log(`after each of ${CYCLES} holds and wakes, the stepping rig's clock is off the page's by ${offs.map((o) => o.toFixed(3)).join(", ")} ms`);
  expect(Math.max(...offs.map(Math.abs)) / STEP_MS, "frames a stepping rig's clock is off the page's after holds and wakes").toBeLessThan(0.5);

  const clock = clockFrom(shown);
  const wakes = samples.flatMap((s, k) => (k > 0 && samples[k - 1]!.held && !s.held ? [k] : []));
  const late = samples.flatMap((s, k) => (Math.abs(s.clock - clock(s)) * 1000 > 1e-3 ? [k] : []));
  const stepped = samples.filter((s) => !s.held).length;
  const { moved, off, allowed, excess } = offTable(shown, samples);
  console.log(`over ${samples.length} frames the rig stepped the lamp on ${stepped}, woke ${wakes.length} times and drew ${late.length} frames off the page's clock; its centre moves ${moved.toExponential(1)} pt, and the lamp is ${off.toFixed(3)} pt off the keyframe table at its own clock where ${allowed.toFixed(3)} pt is allowed`);
  expect(samples.at(-1)!.clock - shown.clock, "seconds the frames ran past the table baked when the layer showed").toBeLessThan(TRACK_SECONDS);
  expect(late.filter((k) => !wakes.includes(k) && !wakes.includes(k - 1)), "frames drawn off the page's clock but neither a wake nor the frame after it").toEqual([]);
  expect(late.length, "frames drawn off the page's clock: more than one a wake").toBeLessThanOrEqual(CYCLES);
  expect(stepped, "frames the rig stepped the lamp between its holds").toBeGreaterThan(CYCLES * 10);
  expect(moved, "points the rig's centre moves while it only sways").toBeLessThan(REST_PT);
  expect(excess, "points the rig's lamp, stepped and held in turn, is past the keyframe table's stepping error and its centre's motion").toBeLessThan(0);
  await context.close();
});
