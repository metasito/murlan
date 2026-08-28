// tests/e2e/feltNap.spec.ts — the crosshatch is brighter under the lamp than
// away from it, measured rather than described.
//
// This is the half of #341 no unit test can reach. A native test can assert
// that a gradient exists with the right stops; only a browser composites the
// weave, the pool and the nap and produces the number that says whether the
// cloth answers to the light. "Looks darker" cost this repo hours
// (`docs/agents/loops.md`), so the assertion is a ratio between two samples of
// the same point, not an impression of one.
//
// **The measure.** Over a 15px patch the felt's own gradients move by a
// fraction of a level, while the weave alternates every 3px between a 2% white
// thread, a 5.5% black one and bare cloth. So `max − min` of luminance across a
// small patch is the crosshatch's amplitude and almost nothing else. Sampling
// the *same* table point in two states — lamp near it, lamp across the table —
// divides out everything about that point except how much light reaches it.
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
 * and the hand — so what is sampled is cloth rather than a card edge. Stated
 * as a fraction of the viewport so it moves with it.
 */
const PATCH = { x: 0.17, y: 0.3, size: 15 };

/**
 * The crosshatch's amplitude at `PATCH`: how far the brightest pixel in it is
 * from the darkest. Reads the composited frame, which is the only place the
 * weave, the pool and the nap are one image.
 */
async function weaveAmplitude(page: import("@playwright/test").Page): Promise<number> {
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
      for (let i = 0; i < data.length; i += 4) {
        const lum = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
        if (lum < lo) lo = lum;
        if (lum > hi) hi = lum;
      }
      return hi - lo;
    },
    { png: shot, patch: PATCH, viewport: VIEWPORT }
  );
}

async function amplitudeAt(
  page: import("@playwright/test").Page,
  baseURL: string,
  id: string
): Promise<number> {
  await page.setViewportSize(VIEWPORT);
  await openCaptureState(page, baseURL, stateById(id));
  await page.waitForTimeout(DEALT_MS);
  return weaveAmplitude(page);
}

test.describe("the cloth answers to the lamp", () => {
  test("the crosshatch is stronger under the light than across the table from it", async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(180_000);

    // `PATCH` sits on the left third, so the lamp is over it in `lamp-left`
    // and at the opposite edge in `lamp-right`. Same pixels, same felt, same
    // seating — the only difference is where the light is.
    const near = await amplitudeAt(page, baseURL!, "lamp-left");
    const far = await amplitudeAt(page, baseURL!, "lamp-right");

    // The defect, as a number: a uniform screen pattern gives a ratio of about
    // 1 whatever the lamp does, because its alpha never changes. Cloth does
    // not. 1.4 is well clear of the compression noise in a PNG at this depth
    // and well under what the change actually produces.
    expect(near / far).toBeGreaterThan(1.4);

    // …and the far side is still cloth rather than a flat wash: the threads
    // are dimmed, not deleted.
    expect(far).toBeGreaterThan(0);
  });
});
