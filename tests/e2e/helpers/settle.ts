// Waiting for the screen to stop moving, rather than for a duration.

import type { Page } from "@playwright/test";

const INTERVAL_MS = 100;
/** Consecutive identical readings that count as still. */
const STILL_SAMPLES = 3;

/**
 * Resolves once every control has held the same box and opacity for three
 * readings, or once `ceilingMs` has passed.
 *
 * The screens these checks probe animate in staggered, so a probe taken too
 * early measures controls still at opacity 0 or still in flight. The ceiling
 * is the budget the fixed wait it replaced used, so a runner slow enough to
 * need all of it behaves exactly as it did before — this can only return
 * earlier, never later.
 *
 * Three readings is 300ms of stillness, against a 42ms gap between staggered
 * items (`Motion.stagger.deal`), so the pause between two items cannot pass
 * for the end of the run. An empty reading never counts as still, which is
 * what stops a screen that has not rendered at all from settling instantly.
 */
export async function settled(page: Page, ceilingMs: number): Promise<void> {
  const deadline = Date.now() + ceilingMs;
  let previous = "";
  let still = 0;

  while (Date.now() < deadline) {
    const reading = await read(page);
    still = reading !== "" && reading === previous ? still + 1 : 0;
    if (still >= STILL_SAMPLES - 1) return;
    previous = reading;
    await page.waitForTimeout(INTERVAL_MS);
  }
}

function read(page: Page): Promise<string> {
  return page.evaluate(() => {
    const INTERACTIVE = new Set(["button", "radio", "switch", "tab", "link", "checkbox"]);
    const parts: string[] = [];
    for (const el of Array.from(document.querySelectorAll("*"))) {
      const role = el.getAttribute("role") ?? (el.tagName === "BUTTON" ? "button" : "");
      if (!INTERACTIVE.has(role)) continue;
      const r = el.getBoundingClientRect();
      parts.push(
        [
          Math.round(r.x),
          Math.round(r.y),
          Math.round(r.width),
          Math.round(r.height),
          getComputedStyle(el).opacity,
        ].join(",")
      );
    }
    return parts.join("|");
  });
}
