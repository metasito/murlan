// The felt's light over the pile, read off the felt's pixels: report-only, so nightly.
import { test, expect } from "./fixtures";
import { PHONES } from "./helpers/phones";
import { setSafeArea } from "./helpers/safeArea";
import { feltPixels, seatAnchor, skiaOnSoftware, untilSkiaFelt } from "./helpers/tableTrace";
import { expectLampOver, openStill, stateById } from "./helpers/lampSeat";

test("under the device's insets the felt's light sits over the pile (D4 #9)", async ({ page, baseURL }) => {
  test.setTimeout(120_000);
  await skiaOnSoftware(page);
  await openStill(page, baseURL!, PHONES.find((p) => p.name === "iPhone 16 Pro")!, stateById("lamp-bottom"));
  const bare = await seatAnchor(page, "pile");
  await setSafeArea(page, 62, 21, 62);
  await expect.poll(async () => (await seatAnchor(page, "pile")).x, { message: "the floor: the insets moved the table" }).not.toBeCloseTo(bare.x, 0);
  await expectLampOver(page, "bottom", "under 62/21/62 insets");
  await untilSkiaFelt(page);

  const pile = await seatAnchor(page, "pile");
  // Only the pool: the vignette's tail runs to the table's far edge and pulls a whole-felt centroid towards the box's middle.
  const { pixels, perPt, origin } = await feltPixels(page);
  const lums = Array.from({ length: pixels.data.length / 4 }, (_, p) => 0.2126 * pixels.data[p * 4] + 0.7152 * pixels.data[p * 4 + 1] + 0.0722 * pixels.data[p * 4 + 2]);
  const pool = lums.reduce((a, b) => Math.max(a, b), 0) / 2;
  let [sum, weight] = [0, 0];
  lums.forEach((lum, p) => {
    if (lum < pool) return;
    sum += (p % pixels.width) * lum * lum;
    weight += lum * lum;
  });
  const centroid = { x: origin.x + (sum / weight + 0.5) / perPt, weight };
  console.log(`light centroid x ${centroid.x.toFixed(1)}, pile centre x ${pile.x.toFixed(1)}`);
  expect(centroid.weight, "the felt drew no light").toBeGreaterThan(0);
  expect(Math.abs(centroid.x - pile.x), `the light's centroid ${centroid.x.toFixed(1)} against the pile's ${pile.x.toFixed(1)}`).toBeLessThanOrEqual(2);
});
