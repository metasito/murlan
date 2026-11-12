// tests/e2e/tableDpr3.spec.ts — the table a DPR 3 phone draws is the table a DPR 2 one draws.
//
// Phones ship at DPR 3 and every other pixel check here runs at 1 or 2, so a seam, a hairline or a
// canvas that only goes wrong at 3 passed them all. One seeded table at rest, drawn at DPR 3 and at
// DPR 2 on the same handset, each box-averaged to one sample per point, compared point by point.
// Text is hidden from both: glyphs are hinted per DPR and differ by more than any limit here.
import type { Browser } from "@playwright/test";
import { test, expect } from "./fixtures";
import { heldTurnTable } from "./helpers/mockupParity";
import { TABLE } from "./helpers/parityRegions";
import { installVirtualClock, stepFrames, stepUntil } from "./helpers/virtualClock";
import { HAND_CARD_BOXES } from "./helpers/selectors";
import { UNLIT_AIR } from "./helpers/tableTrace";
import { PHONES } from "./helpers/phones";
import { PNG } from "pngjs";

const PHONE = PHONES.find((p) => p.name === "iPhone 16 Pro")!;
const SEED = 1255;
/** Past the restored table's entrance. */
const SETTLE = 120;
const NO_TEXT = `${UNLIT_AIR} * { color: transparent !important; text-shadow: none !important; }`;

/**
 * Levels, in the worst channel, at which one point is off its DPR 2 twin: a one-device-pixel line
 * 120 levels off its ground moves its point by 40.
 */
const POINT_DIFF = 40;
/**
 * A fainter line moves each point it crosses less, but crosses them in a row: this many, each this
 * far off. Not lower: the rail's grain, resampled per DPR, runs along its curve at 8 levels for
 * hundreds of points; a one-device-pixel line 36 levels off its ground still moves its points by 12.
 */
const RUN_DIFF = 12;
const RUN_LENGTH = 14;

type Rgba = { width: number; height: number; data: Buffer };

async function tableAt(browser: Browser, baseURL: string, deviceScaleFactor: number): Promise<Rgba> {
  const context = await browser.newContext({ viewport: TABLE, deviceScaleFactor, locale: "it-IT", baseURL, reducedMotion: "reduce" });
  try {
    const page = await context.newPage();
    await installVirtualClock(page, SEED);
    await heldTurnTable(page, baseURL);
    await stepUntil(page, () => page.locator(HAND_CARD_BOXES).first().isVisible(), "the viewer's hand");
    await stepUntil(page, () => page.evaluate(() => ((globalThis as { murlanShadowBuilds?: number }).murlanShadowBuilds ?? 0) > 0), "the Skia felt's shadows");
    const felt = await stepFrames<string | undefined>(page, SETTLE, "window.murlanTrace.frames.at(-1)?.felt");
    expect(felt.at(-1), "the felt drawn").toBe("skia");
    expect(await page.evaluate(() => devicePixelRatio)).toBe(deviceScaleFactor);
    const shot = PNG.sync.read(await page.screenshot({ type: "png", style: NO_TEXT }));
    expect([shot.width, shot.height]).toEqual([TABLE.width * deviceScaleFactor, TABLE.height * deviceScaleFactor]);
    return shot;
  } finally {
    await context.close();
  }
}

function perPoint({ width, data }: Rgba, dpr: number): Float32Array {
  const out = new Float32Array(TABLE.width * TABLE.height * 3);
  for (let y = 0; y < TABLE.height; y++)
    for (let x = 0; x < TABLE.width; x++)
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        for (let dy = 0; dy < dpr; dy++) for (let dx = 0; dx < dpr; dx++) sum += data[((y * dpr + dy) * width + x * dpr + dx) * 4 + c];
        out[(y * TABLE.width + x) * 3 + c] = sum / (dpr * dpr);
      }
  return out;
}

type Run = { x: number; y: number; along: "row" | "column"; length: number };

function runs(diff: Float32Array, atLeast: number): Run[] {
  const { width, height } = TABLE;
  const found: Run[] = [];
  const scan = (along: Run["along"], lines: number, span: number, at: (line: number, i: number) => number) => {
    for (let line = 0; line < lines; line++)
      for (let i = 0, start = 0; i <= span; i++) {
        if (i < span && diff[at(line, i)] >= atLeast) continue;
        if (i - start >= RUN_LENGTH) found.push(along === "row" ? { x: start, y: line, along, length: i - start } : { x: line, y: start, along, length: i - start });
        start = i + 1;
      }
  };
  scan("row", height, width, (y, x) => y * width + x);
  scan("column", width, height, (x, y) => y * width + x);
  return found;
}

test("a seeded table at DPR 3 draws what it draws at DPR 2, point for point", async ({ browser, baseURL }) => {
  test.setTimeout(3 * 60_000);
  expect({ width: PHONE.width, height: PHONE.height }).toEqual(TABLE);
  const [three, two] = await Promise.all([3, 2].map(async (dpr) => perPoint(await tableAt(browser, baseURL!, dpr), dpr)));
  const diff = new Float32Array(TABLE.width * TABLE.height);
  for (let i = 0; i < diff.length; i++) diff[i] = Math.max(...[0, 1, 2].map((c) => Math.abs(three[i * 3 + c] - two[i * 3 + c])));
  const off = [...diff.keys()].filter((i) => diff[i] >= POINT_DIFF).map((i) => ({ x: i % TABLE.width, y: Math.floor(i / TABLE.width), by: Math.round(diff[i]) }));
  const seams = runs(diff, RUN_DIFF);
  console.log(`worst point ${diff.reduce((a, b) => Math.max(a, b), 0).toFixed(1)}, ${off.length} at ${POINT_DIFF} or more; ${seams.length} runs of ${RUN_LENGTH} at ${RUN_DIFF} or more`);
  expect(off.slice(0, 20), `${off.length} points on ${PHONE.name} at DPR 3 are ${POINT_DIFF} or more levels off DPR 2`).toEqual([]);
  expect(seams.slice(0, 20), `${seams.length} runs of ${RUN_LENGTH} points on ${PHONE.name} at DPR 3 are each ${RUN_DIFF} or more levels off DPR 2`).toEqual([]);
});
