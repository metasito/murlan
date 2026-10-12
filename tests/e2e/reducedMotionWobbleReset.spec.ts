// tests/e2e/reducedMotionWobbleReset.spec.ts — a live toggle mid-wobble.
//
// Only a real browser re-running Reanimated's driver reaches the live path — `matchMedia` firing
// while a landed combination wobbles, the play's group re-rendering with the preference, and the style
// coming to rest a frame or two later. tests/native/'s reanimated mock never re-runs a `useAnimatedStyle`.
import { test, expect } from "@playwright/test";
import { openSeededGame } from "./helpers/offlineSeed";
import { installVirtualClock, takeOver } from "./helpers/virtualClock";
import { STEP_MS } from "./helpers/traceDiff";

const VIEWPORT = { width: 844, height: 390 };
// The seat whose turn is seeded: seatFans.spec.ts's own mapping puts the first
// move on the right-hand opponent for a four-seat table with the viewer at 0.
const OPPONENT_TURN = 1;
/** The bot's think time, the throw and the flight take 58 frames; each virtual frame costs this app ~165 ms of real time. */
const FRAMES_TO_WOBBLE = 180;
/** The preference reaches the wobble's style a frame or two after `change`, which the browser fires in real time. */
const FRAMES_TO_REST = 3;

type Stepped = { scale: number | null; frames: number };

/**
 * Steps the page's virtual clock a frame at a time, in one round trip, until the flying cards' scale
 * is engaged (off 1) or at rest, and reads the scale off the node's computed transform: a column's
 * length, whatever the rotation. Null once the node is gone.
 */
function stepUntil({ want, frames, stepMs }: { want: "engaged" | "rest"; frames: number; stepMs: number }): Promise<Stepped> {
  const clock = (globalThis as unknown as { __pwClock?: { controller: { runFor(ms: number): Promise<void> } } }).__pwClock?.controller;
  if (!clock) throw new Error("Playwright's in-page clock is not installed");
  const read = (): number | null => {
    const el = document.querySelector('[data-testid="flying-cards"]') as HTMLElement | null;
    if (!el) return null;
    const t = getComputedStyle(el).transform;
    if (!t || t === "none") return 1;
    const [a, b] = t.slice(t.indexOf("(") + 1, -1).split(",").map(Number);
    return Math.hypot(a, b);
  };
  const done = (s: number | null) =>
    want === "engaged" ? s !== null && Math.abs(s - 1) > 0.01 : s === null || Math.abs(s - 1) < 0.002;
  // `setTimeout` is the virtual clock's, so a real task has to come from a channel: React's scheduler
  // and the browser's `change` event both need one between frames.
  const yieldTask = () =>
    new Promise<void>((resolve) => {
      const ch = new MessageChannel();
      ch.port1.onmessage = () => resolve();
      ch.port2.postMessage(null);
    });
  return (async () => {
    let scale = read();
    for (let i = 0; i < frames; i++) {
      if (want === "engaged" && done(scale)) return { scale, frames: i };
      await clock.runFor(stepMs);
      for (const anim of document.getAnimations()) {
        if (anim.currentTime !== null) anim.currentTime = Number(anim.currentTime) + stepMs;
      }
      await yieldTask();
      scale = read();
      if (want === "rest" && done(scale)) return { scale, frames: i + 1 };
    }
    return { scale, frames };
  })();
}

test.describe("the landing wobble's reset survives a live reduced-motion toggle (#786)", () => {
  test("a toggle mid-wobble brings the cards to rest instead of freezing them scaled", async ({ page, baseURL }) => {
    test.setTimeout(60_000);
    await page.setViewportSize(VIEWPORT);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    // The flight's node goes when its wobble ends, so on a real clock a slow runner reaches the toggle too late.
    await installVirtualClock(page, 1528);

    await openSeededGame(page, baseURL!, 4, undefined, OPPONENT_TURN, false);
    await takeOver(page);

    const atToggle = await page.evaluate(stepUntil, { want: "engaged" as const, frames: FRAMES_TO_WOBBLE, stepMs: STEP_MS });
    expect(atToggle.scale, "the flight reached its wobble").not.toBeNull();
    expect(Math.abs(atToggle.scale! - 1), "the wobble visibly engaged").toBeGreaterThan(0.01);

    await page.emulateMedia({ reducedMotion: "reduce" });
    const after = await page.evaluate(stepUntil, { want: "rest" as const, frames: FRAMES_TO_REST, stepMs: STEP_MS });

    expect(after.scale, "the flying-cards node must still be on screen after the toggle").not.toBeNull();
    expect(Math.abs(after.scale! - 1), `scale ${after.scale} after the toggle, ${atToggle.scale} at it`).toBeLessThan(0.002);
  });
});
