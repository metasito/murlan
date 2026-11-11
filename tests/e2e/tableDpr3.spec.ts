// tests/e2e/tableDpr3.spec.ts — the table a DPR 3 phone draws is the table a DPR 2 one draws.
//
// Phones ship at DPR 3 and every other pixel check here runs at 1 or 2, so a seam, a hairline or a
// canvas that only goes wrong at 3 passed them all. One seeded table at rest, drawn at DPR 3 and at
// DPR 2 on the same handset, each box-averaged to one sample per point, compared point by point.
// Text is hidden from both: glyphs are hinted per DPR and differ by up to 86 levels on their own.
import type { Browser } from "@playwright/test";
import { test, expect } from "./fixtures";
import { heldTurnTable } from "./helpers/mockupParity";
import { installVirtualClock, stepFrames, stepUntil } from "./helpers/virtualClock";
import { HAND_CARD_BOXES } from "./helpers/selectors";
import { rgbaOf, UNLIT_AIR } from "./helpers/tableTrace";
import { PHONES } from "./helpers/phones";

const PHONE = PHONES[2];
const VIEWPORT = { width: PHONE.width, height: PHONE.height };
const SEED = 1255;
/** Past the restored table's entrance. */
const SETTLE = 120;
const NO_TEXT = `${UNLIT_AIR} * { color: transparent !important; }`;

/**
 * Levels, in the worst channel, one point may sit from its DPR 2 twin. Measured at 27 (2026-11-11),
 * all of it on the court cards' art and the felt's weave, both resampled per DPR; a one-device-pixel
 * line 120 levels off its ground moves its point by 40.
 */
const MAX_POINT_DIFF = 40;

type Rgba = { width: number; height: number; data: Buffer };

async function tableAt(browser: Browser, baseURL: string, deviceScaleFactor: number): Promise<Rgba> {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor, locale: "it-IT", baseURL, reducedMotion: "reduce" });
  const page = await context.newPage();
  await installVirtualClock(page, SEED);
  await heldTurnTable(page, baseURL);
  await stepUntil(page, () => page.locator(HAND_CARD_BOXES).first().isVisible(), "the viewer's hand");
  await stepUntil(page, () => page.evaluate(() => ((globalThis as { murlanShadowBuilds?: number }).murlanShadowBuilds ?? 0) > 0), "the Skia felt's shadows");
  const felt = await stepFrames<string | undefined>(page, SETTLE, "window.murlanTrace.frames.at(-1)?.felt");
  expect(felt.at(-1), "the felt drawn").toBe("skia");
  expect(await page.evaluate(() => devicePixelRatio)).toBe(deviceScaleFactor);
  const shot = await rgbaOf(page, await page.screenshot({ type: "png", style: NO_TEXT }));
  await context.close();
  expect([shot.width, shot.height]).toEqual([VIEWPORT.width * deviceScaleFactor, VIEWPORT.height * deviceScaleFactor]);
  return shot;
}

function perPoint({ width, data }: Rgba, dpr: number): Float32Array {
  const { width: w, height: h } = VIEWPORT;
  const out = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        for (let dy = 0; dy < dpr; dy++) for (let dx = 0; dx < dpr; dx++) sum += data[((y * dpr + dy) * width + x * dpr + dx) * 4 + c];
        out[(y * w + x) * 3 + c] = sum / (dpr * dpr);
      }
  return out;
}

test("a seeded table at DPR 3 draws what it draws at DPR 2, point for point", async ({ browser, baseURL }) => {
  test.setTimeout(3 * 60_000);
  const three = perPoint(await tableAt(browser, baseURL!, 3), 3);
  const two = perPoint(await tableAt(browser, baseURL!, 2), 2);
  const off: { x: number; y: number; by: number }[] = [];
  let worst = 0;
  for (let i = 0; i < VIEWPORT.width * VIEWPORT.height; i++) {
    const by = Math.max(...[0, 1, 2].map((c) => Math.abs(three[i * 3 + c] - two[i * 3 + c])));
    worst = Math.max(worst, by);
    if (by > MAX_POINT_DIFF) off.push({ x: i % VIEWPORT.width, y: Math.floor(i / VIEWPORT.width), by: Math.round(by) });
  }
  console.log(`worst point ${worst.toFixed(1)} levels from its DPR 2 twin; ${off.length} over ${MAX_POINT_DIFF}`);
  expect(off.slice(0, 20), `${off.length} points on ${PHONE.name} at DPR 3 differ from DPR 2 by more than ${MAX_POINT_DIFF} levels`).toEqual([]);
});
