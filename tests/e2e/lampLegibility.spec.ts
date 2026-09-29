// tests/e2e/lampLegibility.spec.ts — in the Skia felt's own pixels, the seat on move out-lights the
// brightest other seat by the floor at every phone, and every seat does so about equally (plan 3
// Task 8; the bounds are lib/diagnostics/lampLegibility.ts's, the rings where the table laid them).
import { test, expect, type Page } from "@playwright/test";
import { openCaptureState } from "./helpers/offlineSeed";
import { PHONES } from "./helpers/phones";
import { feltPixels, seatAnchor, skiaOnSoftware, untilSkiaFelt } from "./helpers/tableTrace";
import type { FlyDirection } from "../../components/seatLayout";
import { CAPTURE_STATES } from "../../lib/captureStates";
import { LAMP_FLOOR, LAMP_SYMMETRY, annulusLuminance, evenness, legibility } from "../../lib/diagnostics/lampLegibility";

const SEATS: readonly FlyDirection[] = ["bottom", "right", "top", "left"];

/** Past the deal stagger: every card is at opacity 0 until its own leg of it runs. */
const DEALT_MS = 2_000;

const stateFor = (side: FlyDirection) => {
  const found = CAPTURE_STATES.find((s) => s.id === `lamp-${side}`);
  if (!found) throw new Error(`no capture state lamp-${side}`);
  return found;
};

async function seatMeans(page: Page, baseURL: string, phone: (typeof PHONES)[number], onMove: FlyDirection): Promise<Record<FlyDirection, number>> {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: phone.width, height: phone.height });
  await skiaOnSoftware(page);
  await openCaptureState(page, baseURL, stateFor(onMove));
  await page.waitForTimeout(DEALT_MS);
  await untilSkiaFelt(page);
  const anchors = Object.fromEntries(await Promise.all(SEATS.map(async (s) => [s, await seatAnchor(page, s)] as const)));
  const { pixels, perPt, origin } = await feltPixels(page);
  return Object.fromEntries(
    SEATS.map((s) => [s, annulusLuminance(pixels, { x: anchors[s].x - origin.x, y: anchors[s].y - origin.y }, perPt)])
  ) as Record<FlyDirection, number>;
}

for (const phone of PHONES) {
  test(`${phone.name}: the seat on move out-lights the rest, the same at every seat`, async ({ page, baseURL }) => {
    test.setTimeout(240_000);
    const ratios: number[] = [];
    for (const side of SEATS) ratios.push(legibility(await seatMeans(page, baseURL!, phone, side), side));
    const even = evenness(ratios);
    console.log(`${phone.name}: ${SEATS.map((s, i) => `${s} ${ratios[i].toFixed(2)}`).join(", ")}; evenness ${even.toFixed(2)}`);
    SEATS.forEach((s, i) => expect(ratios[i], `${s} on move over the brightest other seat`).toBeGreaterThanOrEqual(LAMP_FLOOR));
    expect(even, "the worst seat ÷ the best").toBeGreaterThanOrEqual(LAMP_SYMMETRY);
  });
}
