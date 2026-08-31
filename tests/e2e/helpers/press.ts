// tests/e2e/helpers/press.ts — a press that takes time, because a finger does.
//
// `locator.click()` puts the pointer down and up in the same frame, so it
// cannot tell a tap from a hold. A card answers both, and which one it gets
// decides whether it is selected or dragged.
import type { Locator, Page } from "@playwright/test";

/**
 * How long a real tap lasts. Human taps cluster around 60-120ms; this is the
 * upper end, so a tap is unambiguously one and still well short of a hold.
 */
export const TAP_MS = 120;

/**
 * The app's own hold threshold, and a press comfortably past it.
 *
 * `hand.tsx` keeps `HOLD_MS` module-local, so this is a copy rather than an
 * import — `tests/e2eRealPresses.test.ts` fails if the two ever disagree.
 */
export const HOLD_MS = 500;
export const PAST_HOLD_MS = HOLD_MS + 300;

const REACHABLE_MS = 4_000;

/**
 * The middle of a locator, once it will actually receive the press.
 *
 * Through `hover`, which is what keeps everything `click()` was doing: it
 * scrolls the target into view, waits for two identical frames, and refuses a
 * target something else is covering. A bare `boundingBox` skips all three, and
 * a hand that scrolls and animates fails every one of them — the press would
 * land where a card used to be, which is on its neighbour.
 */
async function centre(target: Locator): Promise<{ x: number; y: number }> {
  await target.hover({ timeout: REACHABLE_MS });
  const box = await target.boundingBox();
  if (!box) throw new Error("press: the target has no box — it is not laid out");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * Presses `target` for `ms`, pointer down and up separated in time.
 *
 * Takes the duration rather than defaulting to one: at every call site the
 * length of the press is the thing being asserted.
 */
export async function pressFor(page: Page, target: Locator, ms: number): Promise<void> {
  const { x, y } = await centre(target);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
}

/** A tap: down, a finger's worth of time, up. */
export const tap = (page: Page, target: Locator): Promise<void> => pressFor(page, target, TAP_MS);

/** A press held past the point where the app treats it as a hold. */
export const holdPast = (page: Page, target: Locator): Promise<void> =>
  pressFor(page, target, PAST_HOLD_MS);

/**
 * A press at a point rather than on an element, held for `ms`.
 *
 * For the specs that measure where a card moved to: they read the hand's boxes
 * first and press the coordinates they read, because the assertion is about
 * geometry rather than about which node answered.
 */
export async function pressPointFor(page: Page, x: number, y: number, ms: number): Promise<void> {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
}

/** A tap at a point. */
export const tapPoint = (page: Page, x: number, y: number): Promise<void> =>
  pressPointFor(page, x, y, TAP_MS);
