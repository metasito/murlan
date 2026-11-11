// A target (RULES.md 52), set by the owner's ruling of 2026-11-10 that freezes the S4 rest limits.
// tests/e2e/tableAtRest.spec.ts — a settled table draws nothing (rule 51, docs/adr/0020-the-table-at-rest-plays-precomputed-tracks.md):
// counted per stepped frame on the virtual clock, so a slow runner cannot pass by drawing fewer frames.
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { botMove, heldTurnTable, pass, playLowest } from "./helpers/mockupParity";
import { installVirtualClock, stepThen, stepUntil } from "./helpers/virtualClock";
import { STEP_MS, type TraceFrame } from "./helpers/traceDiff";
import { COUNTED, countRenders, END_B_LEAN, END_B_SAMPLE, type EndBLean, type EndBSample, startRenderCounts, swayShows, TAKE_RENDER_COUNTS, type RenderCounts } from "./helpers/renderCounters";
import { HAND_CARD_BOXES } from "./helpers/selectors";

const VIEWPORT = { width: 874, height: 402 };
const SEED = 1255;
/** Half a sway, so the end-B layer's opacity crosses most of its swing. */
const WINDOW = 240;
/** Two seconds: every later state's window. */
const SETTLED = Math.ceil(2000 / STEP_MS);
/** Past the restored table's own entrance: the deal's lamp breath and the seats' fade. */
const SETTLE = 120;
/** Past a throw's flight, landing, dust and the lamp's glide to the next seat. */
const AFTER_MOVE = 300;
/** The lamp's glide to the next seat moves its light more than half a point a frame for about this long. */
const GLIDE = 80;
/** With motion on, the lamp rig's frame callback still steps the sway into the trace's lamp (#1988 item 7); no other may run at rest. */
const MOTION_CALLBACKS = 1;

const { felt: FELT, handShade: HAND_SHADE, particles: PARTICLES } = COUNTED;

type Frame = RenderCounts & { lamp: TraceFrame["lamp"] };

/**
 * The air's mote views (not the moth's): how many show, their opacities multiplied up to the air, and the transforms
 * they and the views they ride on stand at. Null where the table has no air layer.
 */
const AIR = `(() => {
  const air = document.querySelector('[data-testid="air"]');
  if (!air) return null;
  let lit = 0;
  const transforms = new Set();
  for (const mote of air.querySelectorAll('[data-testid="air-mote"]')) {
    let alpha = 1;
    for (let at = mote; at && at !== air; at = at.parentElement) {
      alpha *= Number(getComputedStyle(at).opacity);
      transforms.add(getComputedStyle(at).transform);
    }
    if (alpha > 0.017) lit++;
  }
  return { lit, transforms: [...transforms].join(";") };
})()`;

type Air = { lit: number; transforms: string } | null;

const READ = `({ ...${TAKE_RENDER_COUNTS}, lamp: window.murlanTrace.frames.at(-1)?.lamp })`;

async function frames(page: Page, n: number): Promise<Frame[]> {
  const out: Frame[] = [];
  for (let i = 0; i < n; i++) out.push(await stepThen<Frame>(page, STEP_MS, READ));
  return out;
}

const drew = (fs: Frame[], key: string) => fs.filter((f) => (f.draws[key] ?? 0) > 0).length;
const total = (fs: Frame[], pick: (f: Frame) => number) => fs.reduce((n, f) => n + pick(f), 0);
const sum = (r: Record<string, number>) => Object.values(r).reduce((n, v) => n + v, 0);
const airMoved = (before: Air, after: Air) => !!before && !!after && before.lit >= 1 && after.lit >= 1 && after.transforms !== before.transforms;

/** One settled window: nothing drawn, written or looping, on a page whose frames still ran and, with motion on, whose motes still move. */
async function expectAtRest(page: Page, state: string, motion: boolean, length: number) {
  const airBefore = await page.evaluate<Air>(AIR);
  const rest = await frames(page, length);
  const airAfter = await page.evaluate<Air>(AIR);
  const counts = {
    draws: total(rest, (f) => sum(f.draws)),
    readPixels: total(rest, (f) => f.readPixels),
    styles: total(rest, (f) => sum(f.styles)),
    loopCallers: new Set(rest.flatMap((f) => Object.keys(f.loops))).size,
    frameCallbacks: Math.max(...rest.map((f) => f.frameCallbacks)),
    stalled: rest.filter((f) => f.frames < 1).length,
  };
  console.log(`${state}, ${length} frames at rest: ${JSON.stringify(counts)}`);
  expect(counts.stalled, `${state}: steps in which the page ran no frame`).toBe(0);
  expect(counts.draws, `${state}: canvas draws at rest`).toBe(0);
  expect(counts.readPixels, `${state}: pixels read back from a canvas at rest`).toBe(0);
  expect(counts.styles, `${state}: style writes under the table at rest`).toBe(0);
  expect(counts.loopCallers, `${state}: requestAnimationFrame callers at rest`).toBeLessThanOrEqual(motion ? 1 : 0);
  expect(counts.frameCallbacks, `${state}: Reanimated frame callbacks active at rest`).toBeLessThanOrEqual(motion ? MOTION_CALLBACKS : 0);
  if (motion) expect(airMoved(airBefore, airAfter), `${state}: the motes did not show as views whose transforms moved`).toBe(true);
  return rest;
}

test("a settled table draws nothing in five states, and draws a play", async ({ browser, baseURL }) => {
  test.setTimeout(6 * 60_000);
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, locale: "it-IT", baseURL });
  const page = await context.newPage();
  await installVirtualClock(page, SEED);
  await countRenders(page);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await heldTurnTable(page, baseURL!);
  await stepUntil(page, () => page.evaluate(() => ((globalThis as { murlanShadowBuilds?: number }).murlanShadowBuilds ?? 0) > 0), "the Skia felt's shadows");
  await stepUntil(page, () => page.locator(HAND_CARD_BOXES).first().isVisible(), "the viewer's hand");
  await startRenderCounts(page);
  await frames(page, SETTLE);

  const sway: (EndBSample | null)[] = [await page.evaluate<EndBSample | null>(END_B_SAMPLE)];
  for (const length of [60, 60, WINDOW - 120]) {
    await expectAtRest(page, "1. the viewer's turn, motion on", true, length);
    sway.push(await page.evaluate<EndBSample | null>(END_B_SAMPLE));
  }
  const picture = await page.evaluate<EndBLean | null>(END_B_LEAN);
  expect(swayShows(sway, picture), "the sway did not show as an end-B layer whose animation runs and whose opacity moved").toBe(true);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await frames(page, SETTLE);
  await expectAtRest(page, "2. the viewer's turn, reduced motion", false, WINDOW);

  await page.emulateMedia({ reducedMotion: "no-preference" });
  await frames(page, SETTLE);
  await playLowest(1)(page);
  const played = await frames(page, SETTLE * 2);
  const moved = played.findIndex((f, i) => i > 0 && Math.abs(f.lamp!.x - played[i - 1].lamp!.x) > 5);
  expect(moved, "the lamp glided to the next seat").toBeGreaterThan(0);
  const glide = played.slice(moved, moved + GLIDE);
  const control = { felt: drew(glide, FELT), handShade: drew(played, HAND_SHADE), particles: drew(played, PARTICLES), styles: total(played, (f) => f.styles.cards ?? 0) };
  console.log(`frames drawn through a play: ${JSON.stringify(control)} (felt of ${GLIDE} gliding)`);
  expect(control.felt, "frames the felt drew while its light glided").toBeGreaterThanOrEqual(GLIDE * 0.8);
  expect(control.handShade, "the hand shade never drew the played hand").toBeGreaterThanOrEqual(1);
  expect(control.particles, "the motes never drew").toBeGreaterThanOrEqual(1);
  expect(control.styles, "no card's view was styled through a play").toBeGreaterThan(0);
  await frames(page, AFTER_MOVE - SETTLE * 2);
  await expectAtRest(page, "3. a bot on move over the viewer's card, motion on", true, SETTLED);

  await botMove(page);
  const thrown = await frames(page, AFTER_MOVE);
  expect(drew(thrown, FELT), "the felt never drew the bot's play").toBeGreaterThanOrEqual(1);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await frames(page, SETTLE);
  await expectAtRest(page, "4. after a bot's play, reduced motion", false, SETTLED);

  await page.emulateMedia({ reducedMotion: "no-preference" });
  await frames(page, SETTLE);
  await pass(page);
  await frames(page, AFTER_MOVE);
  await expectAtRest(page, "5. after a pass, motion on", true, SETTLED);
  await context.close();
});
