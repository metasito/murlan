// tests/e2e/reducedMotionWobbleReset.spec.ts — a live toggle mid-wobble.
//
// `settleForMotion` (components/flightPhysics.ts) has its own unit coverage; what only a real
// browser re-running Reanimated's driver reaches is the live path — `matchMedia` firing while a
// landed combination wobbles, `FlyingCards`' effect re-running, and the style coming to rest on the
// next frame. tests/native/'s reanimated mock never re-runs a `useAnimatedStyle` off a later write.
import { test, expect, type Page } from "@playwright/test";
import { openSeededGame } from "./helpers/offlineSeed";

const VIEWPORT = { width: 844, height: 390 };
// The seat whose turn is seeded: seatFans.spec.ts's own mapping puts the first
// move on the right-hand opponent for a four-seat table with the viewer at 0.
const OPPONENT_TURN = 1;

/** The wobble's scale, off the node's computed transform: a column's length, whatever the rotation. */
function readScale(): number | null {
  const el = document.querySelector('[data-testid="flying-cards"]') as HTMLElement | null;
  if (!el) return null;
  const t = getComputedStyle(el).transform;
  if (!t || t === "none") return 1;
  const nums = t.slice(t.indexOf("(") + 1, -1).split(",").map(Number);
  const [a, b] = nums;
  return Math.hypot(a, b);
}

const scaleOf = (page: Page) => page.evaluate(readScale);

test.describe("the landing wobble's reset survives a live reduced-motion toggle (#786)", () => {
  test("a toggle mid-wobble brings the cards to rest instead of freezing them scaled", async ({ page, baseURL }) => {
    test.setTimeout(60_000);
    await page.setViewportSize(VIEWPORT);
    await page.emulateMedia({ reducedMotion: "no-preference" });

    await openSeededGame(page, baseURL!, 4, undefined, OPPONENT_TURN, false);

    await page.locator('[data-testid="flying-cards"]').waitFor({ state: "attached", timeout: 15_000 });
    let atToggle: number | null = null;
    const engaged = async () => {
      atToggle = await scaleOf(page);
      return atToggle !== null && Math.abs(atToggle - 1) > 0.01;
    };
    await expect.poll(engaged, { timeout: 5_000, intervals: [5], message: "the wobble visibly engaged" }).toBe(true);

    await page.emulateMedia({ reducedMotion: "reduce" });

    // The re-run effect also removes the flight after `Motion.duration.tap`: read before that fires.
    let after: number | null = null;
    const atRest = async () => {
      after = await scaleOf(page);
      return after === null || Math.abs(after - 1) < 0.002;
    };
    await expect.poll(atRest, { timeout: 100, intervals: [5] }).toBe(true).catch(() => {});

    expect(after, "the flying-cards node must still be on screen after the toggle").not.toBeNull();
    expect(Math.abs(after! - 1), `scale ${after} after the toggle, ${atToggle} at it`).toBeLessThan(0.002);
  });
});
