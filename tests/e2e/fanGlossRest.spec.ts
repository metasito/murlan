// tests/e2e/fanGlossRest.spec.ts — an idle turn writes no card style (rule 51): once the lamp's glide to the viewer has come
// within 2 pt, the fans' gloss is drawn at rest, and no card view is written while the sway alone moves the light.
// On the wall clock, as a player's table runs.
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { openSeededGame } from "./helpers/offlineSeed";
import { playAnyLegal } from "./helpers/bot";
import { tap } from "./helpers/press";
import { OTHERS_PLAY, YOUR_TURN_PREFIX } from "./helpers/labels";
import { TABLE, TABLE_STATE } from "./helpers/selectors";
import { countRenders, startRenderCounts } from "./helpers/renderCounters";
import { seedRandomness } from "./helpers/seededRandomness";
import { SWAY, SWAY_KICKED } from "../../components/table/lampRig";

const VIEWPORT = { width: 874, height: 402 };
/** Design points, as the viewport is the design's: the most a gloss may hold still for; `GLOSS_POINT_STEP` is pinned under it in `tests/ui-rules/fanGloss.test.ts`. */
const VISIBLE_STEP_PT = 2;
/** Frames from the glide's last frame outside the step to the backs handing their gloss to the fans: a commit and a layout effect. */
const HAND_OFF_FRAMES = 6;
/** How long the lamp must have rested before the turn is read: a whole second of sway with nothing but the sway moving. */
const RESTED_MS = 1500;
const TURNS = 6;
const SEED = 1;
const BACK_GLOSS = ["card-gloss-spot", "card-gloss-streak", "card-foil-ink", "card-foil-band", "card-foil-glint"]
  .map((id) => `[data-testid="seat-back"] [data-testid="${id}"]`)
  .join(", ");

interface Frame {
  t: number;
  x: number;
  y: number;
  ph: number;
  kick: number;
  rested: boolean;
  cards: number;
  backGloss: number;
  state: string;
}

const SAMPLE = ({ attr, gloss }: { attr: string; gloss: string }) => {
  const w = window as unknown as { murlanTrace: { frames: { lamp?: { x: number; y: number; ph: number; kick: number; rested: boolean } }[] }; murlanRenderCounts: { take(): { styles: Record<string, number> } }; __fanRest: { frames: Frame[]; on: boolean } };
  w.__fanRest = { frames: [], on: true };
  let backGloss = 0;
  new MutationObserver((records) => {
    for (const r of records) if ((r.target as Element).closest(gloss)) backGloss++;
  }).observe(document.querySelector('[data-testid="game-root"]')!, { subtree: true, attributes: true, attributeFilter: ["style"] });
  const tick = () => {
    if (!w.__fanRest.on) return;
    const lamp = w.murlanTrace.frames.at(-1)?.lamp;
    const cards = w.murlanRenderCounts.take().styles.cards ?? 0;
    const state = document.querySelector('[data-testid="game-table"]')?.getAttribute(attr) ?? "";
    if (lamp) w.__fanRest.frames.push({ t: performance.now(), x: lamp.x, y: lamp.y, ph: lamp.ph, kick: lamp.kick, rested: lamp.rested, cards, backGloss, state });
    backGloss = 0;
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

/** In the page: whether the lamp has rested `ms` at the end of the frames sampled so far. */
const RESTED_FOR = (ms: number) => {
  const fs = (window as unknown as { __fanRest: { frames: { t: number; rested: boolean }[] } }).__fanRest.frames;
  let i = fs.length;
  while (i > 0 && fs[i - 1]!.rested) i--;
  return i < fs.length && fs.at(-1)!.t - fs[i]!.t >= ms;
};

test.use({ reducedMotion: "no-preference", deviceScaleFactor: 1, viewport: VIEWPORT });

test("an idle turn writes no card style once the lamp's glide is under a gloss's step", async ({ page, baseURL }) => {
  test.setTimeout(150_000);
  await seedRandomness(page, SEED);
  await countRenders(page);
  await openSeededGame(page, baseURL!, 4);
  await page.locator(TABLE).waitFor();
  await page.evaluate(() => (window as unknown as { murlanTrace: { start(): void } }).murlanTrace.start());
  await startRenderCounts(page);
  await page.evaluate(SAMPLE, { attr: TABLE_STATE, gloss: BACK_GLOSS });

  const yours = page.locator(`${TABLE}[${TABLE_STATE}^="${YOUR_TURN_PREFIX}"]`);
  for (let turn = 0; turn < TURNS; turn++) {
    await yours.waitFor({ timeout: 60_000 });
    const state = (await page.locator(TABLE).getAttribute(TABLE_STATE)) ?? "";
    await page.waitForFunction(RESTED_FOR, RESTED_MS, { timeout: 30_000 });
    const fs = await frames(page);
    const rest = restedRun(fs);
    const centre = (f: Frame) => f.x - (SWAY + SWAY_KICKED * f.kick) * Math.sin(f.ph);
    const cx = rest.reduce((a, f) => a + centre(f), 0) / rest.length;
    const cy = fs.at(-1)!.y;
    const off = (f: Frame) => Math.abs(centre(f) - cx) >= VISIBLE_STEP_PT || Math.abs(f.y - cy) >= VISIBLE_STEP_PT;
    const last = fs.findLastIndex(off);
    // The frames since the last restart can span turns the viewer was auto-passed through: only this turn's are idle.
    const arrived = fs.findLastIndex((f) => f.state !== state) + 1;
    const current = fs.at(-1)!.state === state;
    if (!OTHERS_PLAY.test(state) || !current || last < arrived || last + HAND_OFF_FRAMES >= fs.length) {
      await restart(page);
      // A throw of the viewer's still in flight when the bots answer keeps the lamp from gliding away and back, so answer a play by passing.
      if (current && (OTHERS_PLAY.test(state) || (await playAnyLegal(page)) === null)) await tap(page, page.locator('[data-testid="btn-passa"]'));
      test.info().annotations.push({ type: "skipped", description: `turn ${turn}: ${OTHERS_PLAY.test(state) ? "" : "no bot's play, "}${current ? "" : "moved on, "}arrived ${arrived}, last off ${last} of ${fs.length}` });
      await page.waitForFunction(({ table, attr, was }) => document.querySelector(table)?.getAttribute(attr) !== was, { table: TABLE, attr: TABLE_STATE, was: state }, { timeout: 10_000 });
      continue;
    }
    const glossed = fs.slice(0, last + 1).reduce((a, f) => a + f.backGloss, 0);
    const idle = fs.slice(last + 1 + HAND_OFF_FRAMES);
    const written = idle.reduce((a, f) => a + f.cards, 0);
    const seconds = (idle.at(-1)!.t - idle[0]!.t) / 1000;
    test.info().annotations.push({ type: "idle", description: `turn ${turn}: ${glossed} writes to the backs' gloss over the glide, ${written} card writes over ${seconds.toFixed(2)} s idle` });
    expect(glossed, "the counter sees the backs' gloss written while the lamp glides").toBeGreaterThan(0);
    expect(seconds, "an idle stretch long enough to read").toBeGreaterThan(1);
    expect(written / seconds, "card style writes a second on an idle turn").toBe(0);
    return;
  }
  throw new Error(`no turn in ${TURNS} came to the viewer after a bot's play with the lamp gliding to it`);
});
