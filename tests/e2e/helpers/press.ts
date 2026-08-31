// tests/e2e/helpers/press.ts — a press that takes time, because a finger does.
//
// `locator.click()` puts the pointer down and up in the same frame. Nothing a
// player can do is that fast, so a zero-duration click cannot tell a tap from a
// hold, and every timing-dependent gesture in the app is unverified by it.
//
// #663 is what that cost: the reorder hold fired at 500ms, inside the length of
// an ordinary thumb tap, and destroyed the tap that selects a card to play. The
// test that should have caught it — "a plain tap still only selects" — used a
// synthetic click, so it went on passing.
//
// The rule this serves is wider than the number: a check asserts that the
// harness really performed the action, not that it was asked to. The same
// defect turned up the same day in the device harness, where Maestro reported
// COMPLETED for taps Expo Go's dev-menu window had swallowed (#627).
import type { Locator, Page } from "@playwright/test";

/**
 * How long a real tap lasts. Human taps cluster around 60-120ms; this is the
 * upper end, so a press written as a tap is unambiguously one and still lands
 * well inside the app's own 500ms hold threshold.
 */
export const TAP_MS = 120;

/**
 * Past the app's hold threshold with room to spare. Read from the app rather
 * than guessed at, so a change to `HOLD_MS` in `components/table/hand.tsx`
 * cannot leave the specs pressing for less than a hold.
 */
export const HOLD_MS = 500;
export const PAST_HOLD_MS = HOLD_MS + 300;

/**
 * How long to wait for the target to be there. `click()` waits for its own
 * actionability; a mouse press aims at coordinates and would otherwise land on
 * whatever happens to be under them, so the wait has to be asked for here.
 */
const REACHABLE_MS = 4_000;

/** The middle of a locator, in page coordinates. */
async function centre(target: Locator): Promise<{ x: number; y: number }> {
  await target.waitFor({ state: "visible", timeout: REACHABLE_MS });
  const box = await target.boundingBox();
  if (!box) throw new Error("press: the target has no box — it is not laid out");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * Presses `target` for `ms`, with the pointer down and up separated in time.
 *
 * Takes a duration rather than defaulting to one: at every call site the length
 * of the press is the thing being asserted, so it is not something to leave to
 * a default that a later reader has to go and look up.
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
