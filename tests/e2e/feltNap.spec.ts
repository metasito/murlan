// tests/e2e/feltNap.spec.ts — the cloth under the lamp and away from it is the Lantern mockup's.
//
// The felt is the mockup's `FS` twill (#1257), so the rule is the mockup's own reading at one bare
// patch: the lamp over it, then across the table. What the eye reads is the hatch against its own
// cloth, amplitude over local mean, which only a browser compositing the weave and the light can
// measure; `docs/agents/checks.md` has why "looks darker" is not a measurement.
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test, expect, type Browser, type Page } from "@playwright/test";
import { openCaptureState } from "./helpers/offlineSeed";
import { skiaOnSoftware, untilSkiaFelt } from "./helpers/tableTrace";
import { CAPTURE_STATES } from "../../lib/captureStates";

const VIEWPORT = { width: 874, height: 402 };

const FIXTURE = pathToFileURL(path.resolve(__dirname, "fixtures", "lantern-table", "index.html")).href;

/** Past the deal stagger; every card is at opacity 0 until its own leg runs. */
const DEALT_MS = 2_000;

/** The mockup's `rest` chapter once its deal has settled. */
const MOCKUP_REST_MS = 3_000;

/** How far the app's relief may sit from the mockup's, as a fraction of the mockup's. */
const RELIEF_TOLERANCE = 0.1;

const stateById = (id: string) => {
  const found = CAPTURE_STATES.find((s) => s.id === id);
  if (!found) throw new Error(`no capture state ${id}`);
  return found;
};

/** A patch of bare felt on the table's left third, clear of the seats, the pile and the hand, as a fraction of the table. */
const PATCH = { x: 0.17, y: 0.3, size: 15 };

interface Cloth {
  /** How far the brightest pixel in the patch is from the darkest. */
  amplitude: number;
  /** …and how much light is on the patch at all. */
  mean: number;
}

/** `PATCH` out of a PNG of the table alone. */
async function sample(page: Page, png: Buffer, width: number): Promise<Cloth> {
  return page.evaluate(
    async ({ png, patch, width }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${png}`;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no 2d context");
      ctx.drawImage(img, 0, 0);
      const scale = img.width / width;
      const { data } = ctx.getImageData(
        Math.round(patch.x * img.width),
        Math.round(patch.y * img.height),
        Math.round(patch.size * scale),
        Math.round(patch.size * scale)
      );
      let lo = Infinity;
      let hi = -Infinity;
      let sum = 0;
      for (let i = 0; i < data.length; i += 4) {
        const lum = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
        if (lum < lo) lo = lum;
        if (lum > hi) hi = lum;
        sum += lum;
      }
      return { amplitude: hi - lo, mean: sum / (data.length / 4) };
    },
    { png: png.toString("base64"), patch: PATCH, width }
  );
}

async function appCloth(page: Page, baseURL: string, id: string): Promise<Cloth> {
  await page.setViewportSize(VIEWPORT);
  await skiaOnSoftware(page);
  await openCaptureState(page, baseURL, stateById(id));
  await page.waitForTimeout(DEALT_MS);
  await untilSkiaFelt(page);
  return sample(page, await page.screenshot({ type: "png" }), VIEWPORT.width);
}

/** The mockup's names for the seats, in its `POOL`. */
const MOCKUP_SEAT = { left: "gent", right: "luan" } as const;

/** The mockup at rest with its lamp moved over `side`, the way its `lampStep` would settle it. */
async function mockupCloth(browser: Browser, deviceScaleFactor: number, side: "left" | "right"): Promise<Cloth> {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor });
  const page = await context.newPage();
  await page.goto(FIXTURE);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  const frame = page.locator("#frame");
  const box = (await frame.boundingBox())!;
  await page.setViewportSize({ width: VIEWPORT.width * 2 - Math.round(box.width), height: VIEWPORT.height * 2 });
  await page.evaluate(`(() => {
    T.go("rest", ${MOCKUP_REST_MS});
    const [x, y] = POOL.${MOCKUP_SEAT[side]};
    Object.assign(lamp, { tx: x, ty: y, x, y });
    step(0, true);
  })()`);
  const width = (await frame.boundingBox())!.width;
  expect(Math.round(width), "the mockup's table width").toBe(VIEWPORT.width);
  const cloth = await sample(page, await frame.screenshot({ type: "png" }), width);
  await context.close();
  return cloth;
}

/** The hatch as a fraction of the cloth it sits on. */
const relief = (c: Cloth) => c.amplitude / Math.max(c.mean, 1);

test.describe("the cloth answers to the lamp as the mockup's does", () => {
  test("lit and unlit, the patch reads as the mockup's twill", async ({ page, baseURL, browser }) => {
    test.setTimeout(180_000);

    // `PATCH` sits on the left third, so the lamp is over it in `lamp-left` and across the table
    // in `lamp-right`. Same pixels, same felt, same seating — only the light moves.
    const lit = await appCloth(page, baseURL!, "lamp-left");
    const dark = await appCloth(page, baseURL!, "lamp-right");
    const dpr = await page.evaluate(() => devicePixelRatio);
    const mockLit = await mockupCloth(browser, dpr, "left");
    const mockDark = await mockupCloth(browser, dpr, "right");
    console.log(
      [lit, dark, mockLit, mockDark]
        .map((c, i) => `${["app lit", "app dark", "mockup lit", "mockup dark"][i]}: amp ${c.amplitude.toFixed(1)} mean ${c.mean.toFixed(1)} relief ${relief(c).toFixed(3)}`)
        .join("\n")
    );

    // A seeding failure cannot read as a passing measurement: the lamp really moved, on both.
    expect(dark.mean).toBeLessThan(lit.mean);
    expect(mockDark.mean).toBeLessThan(mockLit.mean);

    // The weave is louder under the lamp in absolute levels, which is what the eye reads first.
    expect(lit.amplitude).toBeGreaterThan(dark.amplitude);

    for (const [ours, theirs, where] of [
      [lit, mockLit, "under the lamp"],
      [dark, mockDark, "across the table from it"],
    ] as const) {
      expect(
        Math.abs(relief(ours) - relief(theirs)) / relief(theirs),
        `relief ${where}: ours ${relief(ours).toFixed(3)} vs the mockup's ${relief(theirs).toFixed(3)}`
      ).toBeLessThan(RELIEF_TOLERANCE);
    }
  });
});
