// tests/e2e/feltNap.spec.ts — the cloth is more textured where the light is,
// not less. Measured, because "looks darker" cost this repo hours
// (`docs/agents/loops.md`).
//
// This is the half of #341 no unit test can reach. A native test can assert
// that a gradient exists with the right stops; only a browser composites the
// weave, the pool and the nap into the one image where the claim is true or
// false.
//
// **The measure, and the mistake it exists to avoid.** Raw crosshatch
// amplitude is not the defect: `weaveDark` is 5.5% *black*, so it already
// scales with whatever it is painted over and the hatch is louder in absolute
// terms under the lamp. That reading is 4:1 in favour of the lamp with a
// uniform weave and proves nothing.
//
// What the eye reads is the hatch measured *against its own cloth*. A surface
// with no light on it must not show more texture than one under the lamp, and
// that is one number: amplitude over local mean, sampled at one point with the
// lamp near it and again with the lamp across the table.
import { test, expect } from "@playwright/test";
import { openCaptureState } from "./helpers/offlineSeed";
import { CAPTURE_STATES } from "../../lib/captureStates";

const VIEWPORT = { width: 874, height: 402 };

/** Past the deal stagger; every card is at opacity 0 until its own leg runs. */
const DEALT_MS = 2_000;

const stateById = (id: string) => {
  const found = CAPTURE_STATES.find((s) => s.id === id);
  if (!found) throw new Error(`no capture state ${id}`);
  return found;
};

/**
 * A patch of bare felt on the table's left third, clear of the seats, the pile
 * and the hand, so what is sampled is cloth rather than a card edge. A fraction
 * of the viewport, so it moves with it.
 */
const PATCH = { x: 0.17, y: 0.3, size: 15 };

interface Cloth {
  /** How far the brightest pixel in the patch is from the darkest. */
  amplitude: number;
  /** …and how much light is on the patch at all. */
  mean: number;
}

/**
 * The patch as the compositor drew it — the weave, the pool and the nap as one
 * image, which is the only place they are one image.
 */
async function cloth(page: import("@playwright/test").Page): Promise<Cloth> {
  const shot = (await page.screenshot({ type: "png" })).toString("base64");
  return page.evaluate(
    async ({ png, patch, viewport }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${png}`;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no 2d context");
      ctx.drawImage(img, 0, 0);
      // The screenshot is in device pixels and the patch in CSS ones.
      const scale = img.width / viewport.width;
      const { data } = ctx.getImageData(
        Math.round(patch.x * viewport.width * scale),
        Math.round(patch.y * viewport.height * scale),
        Math.round(patch.size * scale),
        Math.round(patch.size * scale)
      );
      let lo = Infinity;
      let hi = -Infinity;
      let sum = 0;
      let n = 0;
      for (let i = 0; i < data.length; i += 4) {
        const lum = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
        if (lum < lo) lo = lum;
        if (lum > hi) hi = lum;
        sum += lum;
        n++;
      }
      return { amplitude: hi - lo, mean: sum / n };
    },
    { png: shot, patch: PATCH, viewport: VIEWPORT }
  );
}

async function clothAt(
  page: import("@playwright/test").Page,
  baseURL: string,
  id: string
): Promise<Cloth> {
  await page.setViewportSize(VIEWPORT);
  await openCaptureState(page, baseURL, stateById(id));
  await page.waitForTimeout(DEALT_MS);
  return cloth(page);
}

/** The hatch as a fraction of the cloth it sits on. */
const relief = (c: Cloth) => c.amplitude / Math.max(c.mean, 1);

test.describe("the cloth answers to the lamp", () => {
  test("shows less texture where there is no light, not more", async ({ page, baseURL }) => {
    test.setTimeout(180_000);

    // `PATCH` sits on the left third, so the lamp is over it in `lamp-left`
    // and at the opposite edge in `lamp-right`. Same pixels, same felt, same
    // seating — the only difference is where the light is.
    const lit = await clothAt(page, baseURL!, "lamp-left");
    const dark = await clothAt(page, baseURL!, "lamp-right");

    // Sanity on the states themselves, so a seeding failure cannot read as a
    // passing measurement: the lamp really is somewhere else in the second one.
    expect(dark.mean).toBeLessThan(lit.mean);

    // The defect, as a number: relief *inverted*. A white thread is a fixed
    // lift, so on a nearly black rim it carried several times the relief of
    // the lit middle — the surface with no light on it was the more textured
    // one. A shadow cannot do that, and equal relief either side is the right
    // answer rather than a compromise: that is what a diffuse surface does.
    expect(relief(dark)).toBeLessThanOrEqual(relief(lit));

    // The same thing in absolute levels, which is what the eye reads. The
    // unlit corner has to fall under the floor where a hatch stops being a
    // hatch; a uniform weave leaves it at about three levels here, and the
    // prototype at five.
    expect(dark.amplitude).toBeLessThanOrEqual(1.5);

    // …and the lit cloth was not flattened to buy that. A weave that vanishes
    // everywhere passes both lines above and is not cloth either.
    expect(lit.amplitude).toBeGreaterThan(11);
  });
});
