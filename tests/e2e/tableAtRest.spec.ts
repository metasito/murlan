// A target (RULES.md 52), set by the owner's ruling of 2026-11-10 that freezes the S4 rest limits.
// tests/e2e/tableAtRest.spec.ts — a settled table draws only what moves (rule 51): counted per stepped
// frame on the virtual clock, so a slow runner cannot pass by drawing fewer frames.
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { heldTurnTable, playLowest } from "./helpers/mockupParity";
import { installVirtualClock, stepThen, stepUntil } from "./helpers/virtualClock";
import { STEP_MS, type TraceFrame } from "./helpers/traceDiff";
import { COUNTED, countRenders, END_B_SAMPLE, type EndBSample, startRenderCounts, swayShows, TAKE_RENDER_COUNTS, type RenderCounts } from "./helpers/renderCounters";
import { HAND_CARD_BOXES } from "./helpers/selectors";

const VIEWPORT = { width: 874, height: 402 };
const SEED = 1255;
/** Half a sway: the felt's share of frames depends on where in its swing the window falls, up to 0.37 of any 240. */
const WINDOW = 240;
/** Past the restored table's own entrance: the deal's lamp breath and the seats' fade. */
const SETTLE = 120;
/** The lamp's glide to the next seat moves its light more than half a point a frame for about this long. */
const GLIDE = 80;

const { felt: FELT, handShade: HAND_SHADE, particles: PARTICLES } = COUNTED;

type Frame = RenderCounts & { lamp: TraceFrame["lamp"] };

const READ = `({ ...${TAKE_RENDER_COUNTS}, lamp: window.murlanTrace.frames.at(-1)?.lamp })`;

async function frames(page: Page, n: number): Promise<Frame[]> {
  const out: Frame[] = [];
  for (let i = 0; i < n; i++) out.push(await stepThen<Frame>(page, STEP_MS, READ));
  return out;
}

const drew = (fs: Frame[], key: string) => fs.filter((f) => (f.draws[key] ?? 0) > 0).length;
const total = (fs: Frame[], pick: (f: Frame) => number) => fs.reduce((n, f) => n + pick(f), 0);

test("a settled table redraws its felt only when the light moves, and its cards not at all", async ({ browser, baseURL }, info) => {
  test.setTimeout(3 * 60_000);
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
  const rest: Frame[] = [];
  for (const length of [60, 60, WINDOW - 120]) {
    rest.push(...(await frames(page, length)));
    if (sway.length < 3) sway.push(await page.evaluate<EndBSample | null>(END_B_SAMPLE));
  }
  const counts = {
    felt: drew(rest, FELT),
    feltTwiceRunning: rest.filter((f, i) => i > 0 && (f.draws[FELT] ?? 0) > 0 && (rest[i - 1].draws[FELT] ?? 0) > 0).length,
    handShade: drew(rest, HAND_SHADE),
    particles: drew(rest, PARTICLES),
    readPixels: total(rest, (f) => f.readPixels),
    offscreen: total(rest, (f) => f.draws.offscreen ?? 0),
    cardStyles: total(rest, (f) => f.styles.cards ?? 0),
  };
  info.annotations.push({ type: `frames drawn of ${WINDOW} at rest`, description: JSON.stringify(counts) });
  console.log(`frames drawn of ${WINDOW} at rest: ${JSON.stringify(counts)}`);
  expect(counts.felt, "frames the felt drew while only the sway moved").toBeLessThanOrEqual(WINDOW * 0.4);
  expect(counts.feltTwiceRunning, "frames the felt drew right after drawing, though the sway moves its light under half a point a frame").toBe(0);
  expect(counts.felt >= WINDOW / 60 || swayShows(sway), "the sway neither redrew the felt nor showed as an end-B layer whose animation runs and whose opacity moved").toBe(true);
  expect(counts.handShade, "frames the hand shade drew over cards that had not moved").toBe(0);
  expect(counts.readPixels, "pixels read back from a canvas at rest").toBe(0);
  expect(counts.offscreen, "draws to a canvas outside the document").toBe(0);
  expect(counts.cardStyles, "style writes inside a card's view at rest").toBe(0);
  expect(counts.particles, "frames the motes drew").toBeLessThanOrEqual(WINDOW * 0.55);
  expect(counts.particles, "the motes never drew").toBeGreaterThanOrEqual(1);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await frames(page, SETTLE);
  const reduced = await frames(page, WINDOW);
  expect(drew(reduced, FELT), "frames the felt drew under reduced motion").toBe(0);
  expect(drew(reduced, PARTICLES), "frames the motes drew under reduced motion").toBe(0);

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
  await context.close();
});
