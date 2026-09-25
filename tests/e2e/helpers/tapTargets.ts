import type { Page } from "@playwright/test";
import { expect } from "../fixtures";
import { TOUCH_TARGET_MIN } from "../../../lib/tokens";

/**
 * Controls smaller than the 44pt floor, measured rather than declared.
 *
 * react-native-web reads `hitSlop` on nothing but the legacy Touchable, so on
 * this platform a control's own box is the whole target.
 */
export async function sweepSizes(page: Page, where: string, allow: string[] = []): Promise<void> {
  // The floor crosses into the page as an argument: this callback runs in the
  // browser, where nothing this file imports exists.
  const undersized = await page.evaluate(({ allowed, MIN }) => {
    const out: string[] = [];
    const nameOf = (el: Element): string =>
      (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 50);

    const controls = Array.from(
      document.querySelectorAll<HTMLElement>('button, [role="button"], [role="radio"], [role="switch"]')
    );

    for (const el of controls) {
      if (el.getAttribute("aria-disabled") === "true") continue;
      // A control nested inside another is part of that control's target.
      if (el.parentElement?.closest('button, [role="button"]')) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      if (r.bottom < 0 || r.top > window.innerHeight) continue;
      if (r.right < 0 || r.left > window.innerWidth) continue;

      const { width, height } = r;
      const name = nameOf(el) || "(unnamed)";
      if (allowed.some((a) => name.includes(a))) continue;
      if (width >= MIN && height >= MIN) continue;
      out.push(`${name} — ${Math.round(width)}x${Math.round(height)}`);
    }
    return out;
  }, { allowed: allow, MIN: TOUCH_TARGET_MIN });
  expect(undersized, where).toEqual([]);
}

/**
 * The hand's cards: the fan exposes `step` pixels of each card, and 44pt at 14
 * cards needs ~630px of hand width the table does not have. components/
 * handLayout.ts holds them at WCAG 2.2 SC 2.5.8's 24px instead.
 *
 * Matched against the Italian labels the whole suite is written against and
 * playwright.config.ts pins.
 */
export const UNDERSIZED_BY_DESIGN = ["di Fiori", "di Cuori", "di Quadri", "di Picche", "Jolly"];
