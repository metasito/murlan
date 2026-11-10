// tests/e2e/restEnds.spec.ts — a table at rest carries its sway on the compositor (rule 51): the opacity of the
// end-B layer, a CSS animation baked from the rig's own state, stays within half a point of the lamp the rig
// moves, on the virtual clock.
import { test, expect } from "./fixtures";
import { heldTurnTable } from "./helpers/mockupParity";
import { installVirtualClock, stepThen, stepUntil } from "./helpers/virtualClock";
import { STEP_MS } from "./helpers/traceDiff";
import { HAND_CARD_BOXES } from "./helpers/selectors";
import { END_B_LEAN, END_B_SAMPLE, type EndBLean, type EndBSample, swayShows } from "./helpers/renderCounters";

const VIEWPORT = { width: 874, height: 402 };
const SEED = 1255;
/** The sway's amplitude in design points; the layer's opacity runs 0 to 1 across the two ends. */
const SWAY = 20;
/** The most the baked light may be off the rig's (RESULT.md Q3). */
const HANDOFF_PT = 0.5;
/** Past one whole swing at its slowest, 9.3 s, so the track's centre is read off its two extremes. */
const WINDOW = 640;

const END = '[data-testid="felt-end-b"]';
const READ = `(() => {
  const canvas = document.querySelector('${END}');
  const f = window.murlanTrace.frames.at(-1);
  if (!canvas || canvas.style.visibility !== "visible" || !f) return null;
  const layer = canvas.parentElement;
  return { lx: f.lamp.x, o: Number(getComputedStyle(layer).opacity), running: layer.getAnimations().filter((a) => a.playState === "running").length };
})()`;

interface Sample {
  lx: number;
  o: number;
  running: number;
}

test("the end-B layer's opacity follows the lamp's light to within half a point", async ({ browser, baseURL }) => {
  test.setTimeout(3 * 60_000);
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, locale: "it-IT", baseURL });
  const page = await context.newPage();
  await installVirtualClock(page, SEED);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await heldTurnTable(page, baseURL!);
  await stepUntil(page, () => page.locator(HAND_CARD_BOXES).first().isVisible(), "the viewer's hand");
  await page.evaluate(() => (window as unknown as { murlanTrace: { start(): void } }).murlanTrace.start());
  await stepUntil(page, async () => (await stepThen<Sample | null>(page, null, READ)) !== null, "the table resting on its two ends", { chunkMs: STEP_MS * 12, realMs: 120_000 });

  const samples: Sample[] = [];
  for (let i = 0; i < WINDOW; i++) {
    const s = await stepThen<Sample | null>(page, STEP_MS, READ);
    expect(s, "the table left its two ends while it only swayed").not.toBeNull();
    samples.push(s!);
  }
  expect(Math.min(...samples.map((s) => s.running)), "frames the end-B layer had no running animation").toBeGreaterThanOrEqual(1);

  const layer = [await stepThen<EndBSample | null>(page, 60 * STEP_MS, END_B_SAMPLE), await stepThen<EndBSample | null>(page, 60 * STEP_MS, END_B_SAMPLE), await stepThen<EndBSample | null>(page, 60 * STEP_MS, END_B_SAMPLE)];
  const picture = await page.evaluate<EndBLean | null>(END_B_LEAN);
  console.log(`end B's picture: ${JSON.stringify(picture)}`);
  expect(swayShows(layer, picture), "end B is not a picture lit from the far end of the sway, or its layer does not sway").toBe(true);

  const lows = samples.map((s) => s.lx);
  const centre = (Math.max(...lows) + Math.min(...lows)) / 2;
  expect((Math.max(...lows) - Math.min(...lows)) / 2, "the swing the rig made").toBeGreaterThan(SWAY - 1);
  // The layer is read after the frame's animation step and the trace before it: pair each light with the opacity of the frame before.
  let worst = 0;
  for (let i = 1; i < samples.length; i++) worst = Math.max(worst, Math.abs(samples[i].lx - centre - SWAY * (2 * samples[i - 1].o - 1)));
  console.log(`the baked light is at most ${worst.toFixed(3)} pt off the rig's over ${WINDOW} frames`);
  expect(worst, "points the end-B layer's light is off the rig's").toBeLessThan(HANDOFF_PT);
  await context.close();
});
