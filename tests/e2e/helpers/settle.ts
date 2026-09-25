// Waiting for the screen to stop moving, rather than for a duration.

import { expect, type Page } from "@playwright/test";

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
export async function settled(page: Page, ceilingMs: number, within?: string): Promise<void> {
  const deadline = Date.now() + ceilingMs;
  let previous = "";
  let still = 0;

  while (Date.now() < deadline) {
    const reading = await read(page, within);
    still = reading !== "" && reading === previous ? still + 1 : 0;
    if (still >= STILL_SAMPLES - 1) return;
    previous = reading;
    await page.waitForTimeout(INTERVAL_MS);
  }
}

/**
 * Resolves once every box inside `within` has held its place for three
 * readings, and fails the test if that has not happened by `timeoutMs` — for
 * a check that reads positions, where `settled`'s ceiling would let it read
 * them mid-flight.
 *
 * The boxes that can be seen, and not their opacity: the active seat and a
 * playable GIOCA breathe for as long as they stay that way, and the lamp's
 * flare rides the swaying light at opacity 0 until something sets it off.
 */
export async function atRest(page: Page, within: string, timeoutMs = 15_000): Promise<void> {
  let previous = "";
  let still = 0;
  await expect
    .poll(
      async () => {
        const reading = await read(page, within, true);
        still = reading !== "" && reading === previous ? still + 1 : 0;
        previous = reading;
        return still >= STILL_SAMPLES - 1;
      },
      {
        message: `${within} never came to rest in ${timeoutMs}ms: still moving, or never drawn`,
        timeout: timeoutMs,
        intervals: [INTERVAL_MS],
      }
    )
    .toBe(true);
}

/**
 * `within` widens the reading from the controls to *every* element inside one
 * container. The default is the controls alone, which is what the checks this
 * was written for probe — but a screen can be still by that reading while
 * something un-interactive is mid-entrance, and a spec measuring where things
 * landed has to wait for those too.
 */
function read(page: Page, within?: string, seenBoxes = false): Promise<string> {
  return page.evaluate(({ selector, seenBoxes }) => {
    const INTERACTIVE = new Set(["button", "radio", "switch", "tab", "link", "checkbox"]);
    const root = selector ? document.querySelector(selector) : null;
    if (selector && !root) return "";
    const scope = root ?? document;
    const unseen = new Map<Element, boolean>();
    const isUnseen = (el: Element | null): boolean => {
      if (!el) return false;
      if (!unseen.has(el)) unseen.set(el, getComputedStyle(el).opacity === "0" || isUnseen(el.parentElement));
      return unseen.get(el)!;
    };
    const parts: string[] = [];
    for (const el of Array.from(scope.querySelectorAll("*"))) {
      if (!selector) {
        const role = el.getAttribute("role") ?? (el.tagName === "BUTTON" ? "button" : "");
        if (!INTERACTIVE.has(role)) continue;
      }
      if (seenBoxes && isUnseen(el)) continue;
      const r = el.getBoundingClientRect();
      parts.push(
        [
          Math.round(r.x),
          Math.round(r.y),
          Math.round(r.width),
          Math.round(r.height),
          seenBoxes ? "" : getComputedStyle(el).opacity,
        ].join(",")
      );
    }
    return parts.join("|");
  }, { selector: within, seenBoxes });
}
