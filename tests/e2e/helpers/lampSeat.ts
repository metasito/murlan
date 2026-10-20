// What both lampSeats specs share: a still capture state, and the lamp held over its seat's light.
import type { Page } from "@playwright/test";
import { expect } from "../fixtures";
import { openCaptureState } from "./offlineSeed";
import type { Phone } from "./phones";
import { settledLight, tracedLamp } from "./tableTrace";
import { CAPTURE_STATES, type CaptureState } from "../../../lib/captureStates";

/** "To the nearest point." */
export const NEAREST_PT = 0.5;

export const stateById = (id: string) => CAPTURE_STATES.find((s) => s.id === id)!;

/** Reduced motion: the light snaps to its pool and does not sway, so its point is exact, and there is no deal to wait out. */
export async function openStill(page: Page, baseURL: string, phone: Phone, state: CaptureState): Promise<void> {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: phone.width, height: phone.height });
  await openCaptureState(page, baseURL, state);
}

async function lampOff(page: Page, side: CaptureState["side"]): Promise<{ x: number; y: number }> {
  const [lamp, want] = await Promise.all([tracedLamp(page), settledLight(page, side)]);
  return { x: lamp.x - want.x, y: lamp.y - want.y };
}

export async function expectLampOver(page: Page, side: CaptureState["side"], where: string): Promise<void> {
  const worst = async () => Math.max(...Object.values(await lampOff(page, side)).map(Math.abs));
  await expect
    .poll(worst, { message: `${where}: the lamp is not over the ${side} seat's light`, timeout: 10_000 })
    .toBeLessThanOrEqual(NEAREST_PT);
}
