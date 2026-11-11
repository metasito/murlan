// tests/e2e/fanGlossRest.spec.ts — an idle turn writes no card style (rule 51): once the lamp's glide to the viewer has come
// within the step no gloss shows (`GLOSS_POINT_STEP`), the fans' gloss is drawn at rest, and no card view is written while the
// sway alone moves the light. Unseeded and on the wall clock, as a player's table runs.
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { openApp, startOfflineGame } from "./helpers/navigation";
import { playAnyLegal } from "./helpers/bot";
import { OTHERS_PLAY, YOUR_TURN_PREFIX } from "./helpers/labels";
import { TABLE, TABLE_STATE } from "./helpers/selectors";
import { countRenders, SWAY_PT, startRenderCounts } from "./helpers/renderCounters";
import { GLOSS_POINT_STEP } from "../../components/table/cardGloss";

const VIEWPORT = { width: 874, height: 402 };
/** The viewport is the design's, so the trace's points are design points. */
const STEP = GLOSS_POINT_STEP;
/** Frames from the glide's last frame outside the step to the backs handing their gloss to the fans: a commit and a layout effect. */
const HAND_OFF_FRAMES = 6;
/** How long the lamp must have rested before the turn is read: a whole second of sway with nothing but the sway moving. */
const RESTED_MS = 1500;
const TURNS = 6;

interface Frame {
  t: number;
  x: number;
  y: number;
  ph: number;
  rested: boolean;
  cards: number;
  state: string;
}

const SAMPLE = (attr: string) => {
  const w = window as unknown as { murlanTrace: { frames: { lamp?: { x: number; y: number; ph: number; rested: boolean } }[] }; murlanRenderCounts: { take(): { styles: Record<string, number> } }; __fanRest: { frames: Frame[]; on: boolean } };
  w.__fanRest = { frames: [], on: true };
  const tick = () => {
    if (!w.__fanRest.on) return;
    const lamp = w.murlanTrace.frames.at(-1)?.lamp;
    const cards = w.murlanRenderCounts.take().styles.cards ?? 0;
    const state = document.querySelector('[data-testid="game-table"]')?.getAttribute(attr) ?? "";
    if (lamp) w.__fanRest.frames.push({ t: performance.now(), x: lamp.x, y: lamp.y, ph: lamp.ph, rested: lamp.rested, cards, state });
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

const frames = (page: Page) => page.evaluate(() => (window as unknown as { __fanRest: { frames: Frame[] } }).__fanRest.frames);
const restart = (page: Page) => page.evaluate(() => void ((window as unknown as { __fanRest: { frames: Frame[] } }).__fanRest.frames = []));

/** The frames the lamp has rested through at the end of `fs`. */
const restedRun = (fs: Frame[]) => {
  let i = fs.length;
  while (i > 0 && fs[i - 1]!.rested) i--;
  return fs.slice(i);
};
const heldFor = (run: Frame[]) => (run.length ? run.at(-1)!.t - run[0]!.t : 0);

test.use({ reducedMotion: "no-preference", deviceScaleFactor: 1, viewport: VIEWPORT });

test("an idle turn writes no card style once the lamp's glide is under a gloss's step", async ({ page, baseURL }) => {
  test.setTimeout(150_000);
  await countRenders(page);
  await openApp(page, baseURL!);
  await startOfflineGame(page, { playerCount: 4, gameMode: "free_for_all" });
  await page.locator(TABLE).waitFor();
  await page.evaluate(() => (window as unknown as { murlanTrace: { start(): void } }).murlanTrace.start());
  await startRenderCounts(page);
  await page.evaluate(SAMPLE, TABLE_STATE);

  const yours = page.locator(`${TABLE}[${TABLE_STATE}^="${YOUR_TURN_PREFIX}"]`);
  for (let turn = 0; turn < TURNS; turn++) {
    await yours.waitFor({ timeout: 60_000 });
    const state = (await page.locator(TABLE).getAttribute(TABLE_STATE)) ?? "";
    let fs = await frames(page);
    while (heldFor(restedRun(fs)) < RESTED_MS && fs.length < 60 * 30) {
      await page.waitForTimeout(250);
      fs = await frames(page);
    }
    const rest = restedRun(fs);
    expect(heldFor(rest), "the lamp rests on the viewer's turn").toBeGreaterThanOrEqual(RESTED_MS);
    const cx = rest.reduce((a, f) => a + f.x - SWAY_PT * Math.sin(f.ph), 0) / rest.length;
    const cy = fs.at(-1)!.y;
    const off = (f: Frame) => Math.abs(f.x - SWAY_PT * Math.sin(f.ph) - cx) >= STEP || Math.abs(f.y - cy) >= STEP;
    const last = fs.findLastIndex(off);
    if (!OTHERS_PLAY.test(state) || last < 0 || last + HAND_OFF_FRAMES >= fs.length) {
      if ((await playAnyLegal(page)) === null) await page.locator('[data-testid="btn-passa"]').click();
      await yours.waitFor({ state: "detached", timeout: 10_000 }).catch(() => {});
      await restart(page);
      continue;
    }
    const before = fs.slice(0, last + 1).reduce((a, f) => a + f.cards, 0);
    const idle = fs.slice(last + 1 + HAND_OFF_FRAMES);
    const written = idle.reduce((a, f) => a + f.cards, 0);
    const seconds = (idle.at(-1)!.t - idle[0]!.t) / 1000;
    test.info().annotations.push({ type: "idle", description: `turn ${turn}: ${before} card writes over the glide, ${written} over ${seconds.toFixed(2)} s idle` });
    expect(before, "the counter sees the backs' gloss written while the lamp glides").toBeGreaterThan(0);
    expect(seconds, "an idle stretch long enough to read").toBeGreaterThan(1);
    expect(written / seconds, "card style writes a second on an idle turn").toBe(0);
    return;
  }
  throw new Error(`no turn in ${TURNS} came to the viewer after a bot's play with the lamp gliding to it`);
});
