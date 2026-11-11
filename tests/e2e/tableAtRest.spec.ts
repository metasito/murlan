// A target (RULES.md 52), set by the owner's ruling of 2026-11-10 that freezes the S4 rest limits.
// tests/e2e/tableAtRest.spec.ts — a settled table draws nothing (rule 51, docs/adr/0020-the-table-at-rest-plays-precomputed-tracks.md):
// counted per stepped frame on the virtual clock, so a slow runner cannot pass by drawing fewer frames.
import type { Page, TestInfo } from "@playwright/test";
import { test, expect } from "./fixtures";
import { botMove, heldTurnTable, pass, playLowest } from "./helpers/mockupParity";
import { installVirtualClock, stepFrames, stepUntil } from "./helpers/virtualClock";
import { STEP_MS, type TraceFrame } from "./helpers/traceDiff";
import { COUNTED, countRenders, END_B_LEAN, END_B_SAMPLE, type EndBLean, type EndBSample, startRenderCounts, swayRuns, swayShows, TAKE_RENDER_COUNTS, type RenderCounts } from "./helpers/renderCounters";
import { HAND_CARD_BOXES, TABLE_STATE } from "./helpers/selectors";
import { cardViewShadows, contactsOf, SHADE_CANVAS } from "./helpers/cardContact";

const VIEWPORT = { width: 874, height: 402 };
const SEED = 1255;
/** Half a sway, so the end-B layer's opacity crosses most of its swing. */
const WINDOW = 240;
const SETTLED = Math.ceil(2000 / STEP_MS);
/** Where a window reads the end-B layer, besides its first and last frame. */
const SWAY_SAMPLES_AT = [60, 120];
/** Past the restored table's own entrance: the deal's lamp breath and the seats' fade. */
const SETTLE = 120;
/** Past a throw's flight, landing, dust and the lamp's glide to the next seat. */
const AFTER_MOVE = 300;
const PLAY_CONTROL = SETTLE * 2;
const AFTER_CONTROL = AFTER_MOVE - PLAY_CONTROL;
/** The lamp's glide to the next seat moves its light more than half a point a frame for about this long. */
const GLIDE = 80;

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

const run = async (page: Page, n: number) => void (await stepFrames(page, n));
const take = (page: Page) => page.evaluate<RenderCounts>(TAKE_RENDER_COUNTS);
const drew = (fs: Frame[], key: string) => fs.filter((f) => (f.draws[key] ?? 0) > 0).length;
const total = (fs: Frame[], pick: (f: Frame) => number) => fs.reduce((n, f) => n + pick(f), 0);
const sum = (r: Record<string, number>) => Object.values(r).reduce((n, v) => n + v, 0);
const airMoved = (before: Air, after: Air) => !!before && !!after && before.lit >= 1 && after.lit >= 1 && after.transforms !== before.transforms;

/** The table's state sentence, the cards the opponents' badges hold, and the cards on the pile, by id. */
const table = (page: Page) =>
  page.evaluate((attr) => ({
    said: document.querySelector(`[${attr}]`)?.getAttribute(attr) ?? null,
    held: [...document.querySelectorAll('[data-testid="seat-card-count"]')].reduce((n, b) => n + Number(b.textContent), 0),
    pile: [...document.querySelectorAll('[id^="card-pile:"]')].map((c) => c.id),
    flying: document.querySelectorAll('[data-testid="flying-card"]').length,
  }), TABLE_STATE);

/** `lean` reads end B's picture back as well: once a spec, for a second readback of that canvas warns, and a warning fails the test. */
async function expectAtRest(page: Page, info: TestInfo, state: string, motion: boolean, length: number, lean = false): Promise<void> {
  await take(page);
  const airBefore = await page.evaluate<Air>(AIR);
  const sway: (EndBSample | null)[] = [await page.evaluate<EndBSample | null>(END_B_SAMPLE)];
  let at = 0;
  for (const to of [...SWAY_SAMPLES_AT.filter((t) => t < length), length]) {
    await run(page, to - at);
    at = to;
    sway.push(await page.evaluate<EndBSample | null>(END_B_SAMPLE));
  }
  const counts = await take(page);
  const airAfter = await page.evaluate<Air>(AIR);
  const picture = lean ? await page.evaluate<EndBLean | null>(END_B_LEAN) : null;
  const seen = {
    frames: counts.frames,
    draws: sum(counts.draws),
    readPixels: counts.readPixels,
    styles: sum(counts.styles),
    loopCallers: Object.keys(counts.loops).length,
    frameCallbacks: counts.maxFrameCallbacks,
    frameCallbacksAtEnd: counts.frameCallbacks,
  };
  const label = `${state}, frames 0–${length} at rest`;
  info.annotations.push({ type: label, description: JSON.stringify(seen) });
  console.log(`${label}: ${JSON.stringify(seen)}`);
  expect(seen.frames, `${label}: frames the page ran`).toBe(length);
  expect(seen.draws, `${label}: canvas draws`).toBe(0);
  expect(seen.readPixels, `${label}: pixels read back from a canvas`).toBe(0);
  expect(seen.styles, `${label}: style writes under the table`).toBe(0);
  expect(seen.frameCallbacks, `${label}: the most Reanimated frame callbacks active in a frame`).toBe(0);
  expect(seen.loopCallers, `${label}: requestAnimationFrame callers`).toBe(0);
  if (!motion) return;
  expect(airMoved(airBefore, airAfter), `${label}: the motes did not show as views whose transforms moved`).toBe(true);
  if (lean) expect(swayShows(sway, picture), `${label}: the sway did not show as an end-B layer whose animation runs, whose opacity moved and whose picture leans`).toBe(true);
  else expect(swayRuns(sway), `${label}: the sway did not show as an end-B layer whose animation runs and whose opacity moved`).toBe(true);
}

test("a settled table draws nothing in five states, and draws a play", async ({ browser, baseURL }, info) => {
  test.setTimeout(4 * 60_000);
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, locale: "it-IT", baseURL });
  const page = await context.newPage();
  await installVirtualClock(page, SEED);
  await countRenders(page);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await heldTurnTable(page, baseURL!);
  await stepUntil(page, () => page.evaluate(() => ((globalThis as { murlanShadowBuilds?: number }).murlanShadowBuilds ?? 0) > 0), "the Skia felt's shadows");
  await stepUntil(page, () => page.locator(HAND_CARD_BOXES).first().isVisible(), "the viewer's hand");
  await startRenderCounts(page);
  await run(page, SETTLE);
  await expectAtRest(page, info, "1. the viewer's turn, motion on", true, WINDOW, true);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await run(page, SETTLE);
  await expectAtRest(page, info, "2. the viewer's turn, reduced motion", false, WINDOW);

  await page.emulateMedia({ reducedMotion: "no-preference" });
  await run(page, SETTLE);
  await take(page);
  await playLowest(1)(page);
  const played = await stepFrames<Frame>(page, PLAY_CONTROL, READ);
  const moved = played.findIndex((f, i) => i > 0 && Math.abs(f.lamp!.x - played[i - 1].lamp!.x) > 5);
  expect(moved, "the lamp glided to the next seat").toBeGreaterThan(0);
  const glide = played.slice(moved, moved + GLIDE);
  const shadeCanvas = (await page.locator(SHADE_CANVAS).count()) > 0;
  const pile = await cardViewShadows(page, '[data-testid="pile-card"]');
  const pileRead = pile.cards.map((c) => contactsOf(c, pile.s));
  const control = {
    felt: drew(glide, FELT),
    handShade: drew(played, HAND_SHADE),
    pileContacts: pileRead.map((c) => c.contacts),
    particles: drew(played, PARTICLES),
    styles: total(played, (f) => f.styles.cards ?? 0),
  };
  info.annotations.push({ type: "frames drawn through a play", description: JSON.stringify(control) });
  console.log(`frames drawn through a play: ${JSON.stringify(control)} (felt of ${GLIDE} gliding)`);
  expect(control.felt, "frames the felt drew while its light glided").toBeGreaterThanOrEqual(GLIDE * 0.8);
  expect(pile.cards.length, "cards on the pile").toBeGreaterThan(0);
  if (shadeCanvas) {
    expect(control.handShade, "the hand shade never drew the played hand").toBeGreaterThanOrEqual(1);
    expect(pile.cards.flatMap((c) => c.shadows), "pile cards' own shadows while the hand shade draws their contact").toEqual([]);
  } else {
    expect(control.pileContacts, "each pile card's contacts").toEqual(pile.cards.map(() => 1));
    expect(pileRead.flatMap((c) => c.others), "pile cards' shadows beyond their contact").toEqual([]);
  }
  expect(control.particles, "the motes never drew").toBeGreaterThanOrEqual(1);
  expect(control.styles, "no card's view was styled through a play").toBeGreaterThan(0);
  await run(page, AFTER_CONTROL);
  await expectAtRest(page, info, "3. a bot on move over the viewer's card, motion on", true, SETTLED);

  const beforeBot = await table(page);
  await botMove(page);
  const afterBot = await table(page);
  expect(afterBot.held, "the bot played cards, rather than passing").toBeLessThan(beforeBot.held);
  expect(afterBot.said, "the table's state sentence after the bot's play").not.toBe(beforeBot.said);
  await run(page, AFTER_MOVE);
  const landed = await table(page);
  expect(landed.pile.filter((id) => !beforeBot.pile.includes(id)).length, "the bot's cards on the pile").toBe(beforeBot.held - afterBot.held);
  expect(landed.flying, "cards still flying after the bot's play").toBe(0);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await run(page, SETTLE);
  await expectAtRest(page, info, "4. after a bot's play, reduced motion", false, SETTLED);

  await page.emulateMedia({ reducedMotion: "no-preference" });
  await run(page, SETTLE);
  const beforePass = await table(page);
  await pass(page);
  const afterPass = await table(page);
  expect(afterPass.said, "the turn moved on the pass").not.toBe(beforePass.said);
  expect(afterPass.held, "cards left the opponents' hands on a pass").toBe(beforePass.held);
  await run(page, AFTER_MOVE);
  await expectAtRest(page, info, "5. after a pass, motion on", true, SETTLED);
  await context.close();
});
