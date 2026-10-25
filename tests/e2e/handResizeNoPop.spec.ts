// tests/e2e/handResizeNoPop.spec.ts — as the viewer's turn ends and begins again, a hand card's painted
// size moves between its two sizes over the resize and never shows the new size before its time (#1829).
import { test, expect } from "./fixtures";
import type { Locator, Page } from "@playwright/test";
import { offlineSave, resumeOnVirtualClock } from "./helpers/offlineSeed";
import { installVirtualClock, paintedFrames, step, stepThen, stepUntil, type EachPaint } from "./helpers/virtualClock";
import { STEP_MS } from "./helpers/traceDiff";
import { HAND_SCALE, HAND_SCALE_ON_TURN } from "../../components/cardFaceModel";
import { Motion } from "../../lib/tokens";

const TURN_RATIO = HAND_SCALE_ON_TURN / HAND_SCALE;
const WATCHED = "K_spades";
const SETTLE_MS = 400;
/** Relative: two frames of one settled size agree far inside this; one frame of the resize moves over 1%. */
const SIZE_TOLERANCE = 0.002;

/**
 * `w` is the wrapper's laid-out width and `s` its transform scale; `faceW` is the painted face's
 * laid-out width inside it. Their products are the widths the player sees.
 */
interface Frame { t: number; w: number; s: number; faceW: number }

type Series = "wrapper" | "face";
const drawn = (f: Frame, series: Series) => (series === "wrapper" ? f.w : f.faceW) * f.s;
const near = (a: number, b: number) => Math.abs(a / b - 1) < SIZE_TOLERANCE;

async function press(page: Page, target: Locator) {
  const box = (await target.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await step(page, 8 * STEP_MS);
  await page.mouse.up();
  await step(page);
}

interface Resize { from: number; to: number; frames: Frame[] }

/** Every resize the trace holds, from its last settled frame to its first at the other size. */
function resizes(frames: Frame[], series: Series, big: number, trace: string): Resize[] {
  const small = big / TURN_RATIO;
  const out: Resize[] = [];
  let i = 1;
  while (i < frames.length) {
    const was = drawn(frames[i - 1], series);
    if (near(drawn(frames[i], series), was)) {
      i++;
      continue;
    }
    expect(near(was, big) || near(was, small), `${series}: a resize leaves from a settled size, not ${was.toFixed(2)}: ${trace}`).toBe(true);
    const to = near(was, big) ? small : big;
    let j = i;
    while (j < frames.length && !near(drawn(frames[j], series), to)) j++;
    expect(j, `${series}: the resize from ${was.toFixed(2)} reaches ${to.toFixed(2)}: ${trace}`).toBeLessThan(frames.length);
    out.push({ from: was, to, frames: frames.slice(i - 1, j + 1) });
    i = j + 1;
  }
  return out;
}

function frameText(f: Frame, t0: number) {
  return `+${(f.t - t0).toFixed(0)}ms width ${f.w.toFixed(2)} face ${f.faceW.toFixed(2)} scale ${f.s.toFixed(4)}`;
}

test("a hand card moves between its two sizes on every frame of a turn change, with no pop", async ({ page, baseURL }) => {
  test.setTimeout(240_000);
  // On the real clock the resize's 120 ms can pass inside the one long task that commits it (#1806).
  await installVirtualClock(page, 1829);
  await paintedFrames(page);
  await page.addInitScript((id) => {
    const w = window as unknown as { __frames: Frame[]; murlanEachPaint: EachPaint };
    w.__frames = [];
    w.murlanEachPaint(() => {
      const card = document.querySelector<HTMLElement>(`[data-testid="hand-card-${id}"]`);
      const face = card?.querySelector<HTMLElement>('[data-testid="card-box"]');
      if (!card || !face) return;
      const m = new DOMMatrixReadOnly(getComputedStyle(card).transform);
      w.__frames.push({ t: performance.now(), w: parseFloat(getComputedStyle(card).width), s: Math.hypot(m.a, m.b), faceW: parseFloat(getComputedStyle(face).width) });
    });
  }, WATCHED);
  // The viewer leads and the held bot answers when told: the turn ends, then begins.
  const save = offlineSave({ seats: 2, holding: [["3_hearts", "7_clubs", WATCHED, "A_diamonds"], ["4_spades", "8_hearts", "Q_clubs"]] });
  await resumeOnVirtualClock(page, baseURL!, save);

  const play = page.getByTestId("btn-gioca");
  await stepUntil(page, () => play.isVisible(), "the viewer's turn", { chunkMs: STEP_MS });
  await step(page, SETTLE_MS);
  const before = await page.evaluate(() => (window as unknown as { __frames: Frame[] }).__frames.length);
  await press(page, page.getByRole("button", { name: "3 di Cuori", exact: true }));
  await press(page, play);
  await step(page, SETTLE_MS);
  await page.evaluate(() => (globalThis as { murlanBotMove?: () => void }).murlanBotMove!());

  // Done once the card has left its turn size, come back to it, and held it for SETTLE_MS.
  const doneBy = Date.now() + 180_000;
  const done = `(() => {
    const f = window.__frames.slice(${before});
    const w = (x) => x.w * x.s, big = w(f[0]);
    const leftAt = f.findIndex((x) => Math.abs(w(x) / big - 1) > ${SIZE_TOLERANCE});
    if (leftAt < 0) return false;
    const back = f.slice(leftAt).findIndex((x) => Math.abs(w(x) / big - 1) < ${SIZE_TOLERANCE} / 10);
    if (back < 0) return false;
    let last = f.length - 1;
    while (last > 0 && Math.abs(w(f[last]) / w(f[last - 1]) - 1) < ${SIZE_TOLERANCE} / 10) last--;
    return f[f.length - 1].t - f[last].t >= ${SETTLE_MS} && Math.abs(w(f[f.length - 1]) / big - 1) < ${SIZE_TOLERANCE} / 10;
  })()`;
  while (!(await stepThen<boolean>(page, STEP_MS, done))) {
    expect(Date.now(), "the turn left the viewer and came back").toBeLessThan(doneBy);
  }
  const frames = (await page.evaluate(() => (window as unknown as { __frames: Frame[] }).__frames)).slice(before);

  const t0 = frames[0].t;
  const trace = frames
    .filter((f, i) => i === 0 || f.w !== frames[i - 1].w || f.s !== frames[i - 1].s || f.faceW !== frames[i - 1].faceW)
    .map((f) => frameText(f, t0))
    .join("; ");
  const big = drawn(frames[0], "wrapper");
  expect(near(drawn(frames[0], "face"), big), `the face fills its card at rest: ${trace}`).toBe(true);

  for (const series of ["wrapper", "face"] as const) {
    const found = resizes(frames, series, big, trace);
    for (const { from, to, frames: r } of found) {
      const lo = Math.min(from, to);
      const hi = Math.max(from, to);
      const start = r[0].t;
      const reached = r[r.length - 1];
      expect(reached.t - start, `${series}: the new size ${to.toFixed(2)} drawn before its time, on ${frameText(reached, t0)}: ${trace}`).toBeGreaterThanOrEqual(Motion.handResize - STEP_MS);
      const inside = r.slice(1, -1);
      for (const f of inside) {
        const d = drawn(f, series);
        expect(d > lo && d < hi, `${series}: drawn ${d.toFixed(2)} outside ${lo.toFixed(2)}..${hi.toFixed(2)} on ${frameText(f, t0)}: ${trace}`).toBe(true);
      }
      // The floor: the window has frames, and the size strictly moves across them toward the new one.
      expect(inside.length, `${series}: frames inside the resize: ${trace}`).toBeGreaterThanOrEqual(Math.floor(Motion.handResize / STEP_MS) - 2);
      for (let k = 1; k < r.length; k++) {
        const step = (drawn(r[k], series) - drawn(r[k - 1], series)) * Math.sign(to - from);
        expect(step, `${series}: the drawn width moves toward ${to.toFixed(2)} on ${frameText(r[k], t0)}: ${trace}`).toBeGreaterThan(0);
      }
    }
    expect(found.map((r) => (r.to < r.from ? "shrink" : "grow")), `${series}: the turn ended and began once each: ${trace}`).toEqual(["shrink", "grow"]);
  }
});
