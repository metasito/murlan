// tests/e2e/reducedMotionSquashReset.spec.ts — a live toggle mid-flight.
//
// `settleForMotion` (components/gameTableModel.ts) is a pure function with its
// own unit coverage (#731, PR #783); what nothing reaches is whether the
// *live* path actually works — `AccessibilityInfo`/`matchMedia` firing while a
// card is mid-flight, re-running `FlyingCards`' effect, and the animated style
// landing deformation-free on the very next frame. `tests/native/` cannot see
// this: its reanimated mock evaluates a `useAnimatedStyle` worklet once at
// mount and never re-runs it off a later `.value` write (`docs/agents/loops.md`),
// so a post-mount toggle is invisible to it either way. Only a real browser
// re-running Reanimated's own driver proves it (#786).
import { test, expect, type Page } from "@playwright/test";
import { openSeededGame } from "./helpers/offlineSeed";

const VIEWPORT = { width: 844, height: 390 };
// The seat whose turn is seeded: seatFans.spec.ts's own mapping puts the first
// move on the right-hand opponent for a four-seat table with the viewer at 0.
const OPPONENT_TURN = 1;

/**
 * The squash's own scale factors, decomposed off the node's *computed* CSS
 * transform rather than trusted from a shared value — what a player sees is
 * pixels on screen, not the worklet's own state. `getComputedStyle` always
 * normalises to `matrix(...)` (2D) or `matrix3d(...)` (3D); either way the
 * linear part's two column vectors give the scale along each axis, and a
 * rotation (the throw's own tilt) does not change a column's length, so this
 * reads the true scale regardless of what the card is rotated to at the time.
 */
function readSquash(): { x: number; y: number } | null {
  const el = document.querySelector('[data-testid="flying-cards"]') as HTMLElement | null;
  if (!el) return null;
  const t = getComputedStyle(el).transform;
  if (!t || t === "none") return { x: 1, y: 1 };
  const nums = t
    .slice(t.indexOf("(") + 1, -1)
    .split(",")
    .map(Number);
  // matrix(a, b, c, d, e, f) columns are [a,b] and [c,d]; matrix3d's first two
  // columns of a 4x4 are the same pair, spaced four apart.
  const [a, b, c, d] = t.startsWith("matrix3d") ? [nums[0], nums[1], nums[4], nums[5]] : nums;
  return { x: Math.hypot(a, b), y: Math.hypot(c, d) };
}

async function squashOf(page: Page): Promise<{ x: number; y: number } | null> {
  return page.evaluate(readSquash);
}

test.describe("the landing squash's reset survives a live reduced-motion toggle (#786)", () => {
  test("a mid-flight toggle flattens the squash instead of freezing it deformed", async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(60_000);
    await page.setViewportSize(VIEWPORT);
    // Full motion throughout the seed and the throw — a flight skipped by
    // reduced motion from the start has no squash for a mid-flight toggle to
    // catch.
    await page.emulateMedia({ reducedMotion: "no-preference" });

    await openSeededGame(page, baseURL!, 4, undefined, OPPONENT_TURN, false);

    const flying = page.locator('[data-testid="flying-cards"]');
    await flying.waitFor({ state: "attached", timeout: 15_000 });

    // Wait for the squash to actually be engaged, not merely mounted — a
    // toggle fired before contact would prove nothing about the reset this
    // ticket is about.
    await page.waitForFunction(
      () => {
        const el = document.querySelector('[data-testid="flying-cards"]') as HTMLElement | null;
        if (!el) return false;
        const t = getComputedStyle(el).transform;
        if (!t || t === "none") return false;
        const nums = t.slice(t.indexOf("(") + 1, -1).split(",").map(Number);
        const [c, d] = t.startsWith("matrix3d") ? [nums[4], nums[5]] : [nums[2], nums[3]];
        return Math.hypot(c, d) < 0.95;
      },
      undefined,
      { polling: "raf", timeout: 5_000 }
    );

    const atToggle = await squashOf(page);
    expect(atToggle, "the squash must be visibly engaged before the toggle proves anything").not.toBeNull();
    expect(
      atToggle!.y,
      `expected the squash caught mid-flight to be visibly compressed, got y=${atToggle!.y}`
    ).toBeLessThan(0.95);

    // The live toggle this ticket is about.
    await page.emulateMedia({ reducedMotion: "reduce" });

    // The same effect that resets the squash also schedules the flight's own
    // removal at `Motion.duration.tap` (120ms) once it re-runs under reduced
    // motion — read before that fires, or there is no node left to read. A
    // bounded poll for the recovered value, rather than a flat sleep, gets the
    // earliest honest reading instead of racing that unmount on every run.
    await page
      .waitForFunction(
        () => {
          const el = document.querySelector('[data-testid="flying-cards"]') as HTMLElement | null;
          if (!el) return true; // Already gone — stop waiting, the read below reports it.
          const t = getComputedStyle(el).transform;
          if (!t || t === "none") return true;
          const nums = t.slice(t.indexOf("(") + 1, -1).split(",").map(Number);
          const [a, b, c, d] = t.startsWith("matrix3d") ? [nums[0], nums[1], nums[4], nums[5]] : nums;
          return Math.hypot(a, b) > 0.98 && Math.hypot(c, d) > 0.98;
        },
        undefined,
        { polling: "raf", timeout: 100 }
      )
      .catch(() => {});

    const after = await squashOf(page);
    expect(after, "the flying-cards node must still be on screen after the toggle").not.toBeNull();
    const msg = `expected no scale deformation after a mid-flight reduced-motion toggle, got x=${after!.x}, y=${after!.y} (was x=${atToggle!.x}, y=${atToggle!.y} at the toggle — a frozen reset would still read close to that)`;
    expect(Math.abs(after!.x - 1), msg).toBeLessThan(0.02);
    expect(Math.abs(after!.y - 1), msg).toBeLessThan(0.02);
  });
});
