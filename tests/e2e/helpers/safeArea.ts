import type { Page } from "@playwright/test";
import { TABLE_SCREEN } from "./selectors.ts";
import { atRest } from "./settle.ts";

const PROBE = 'div[style*="safe-area-inset-left"]';

/**
 * Overrides the safe-area probe's padding, so the app reads the insets a landscape iPhone reports.
 * On web react-native-safe-area-context appends a hidden probe div with `padding-*:
 * env(safe-area-inset-*)`, the only element whose inline style names `safe-area-inset-left`, and
 * reports its computed padding on the `transitionend` of its own 0.05s padding transition — the
 * same path a notched iPhone takes, not a mock.
 *
 * Resolves once that report has gone out and the table has laid itself out again. An unchanged
 * padding fires no `transitionend`, and needs none: the app already holds those insets.
 */
export async function setSafeArea(page: Page, left: number, bottom: number, right: number): Promise<void> {
  const reports = await page.evaluate(
    ({ probe, left, bottom, right }) => {
      const el = document.querySelector(probe);
      if (!el) throw new Error("setSafeArea: no safe-area probe in the page");
      const now = getComputedStyle(el);
      const unchanged = [now.paddingLeft, now.paddingBottom, now.paddingRight].join() === [left, bottom, right].map((n) => `${n}px`).join();
      const flag = window as unknown as { __safeAreaReported?: boolean };
      flag.__safeAreaReported = false;
      el.addEventListener("transitionend", () => (flag.__safeAreaReported = true), { once: true });
      const id = "e2e-safe-area";
      document.getElementById(id)?.remove();
      const style = document.createElement("style");
      style.id = id;
      style.textContent =
        `${probe} {` +
        ` padding-left: ${left}px !important;` +
        ` padding-right: ${right}px !important;` +
        ` padding-bottom: ${bottom}px !important; }`;
      document.head.appendChild(style);
      return !unchanged;
    },
    { probe: PROBE, left, bottom, right }
  );
  if (reports) {
    await page.waitForFunction(() => (window as unknown as { __safeAreaReported?: boolean }).__safeAreaReported === true, null, {
      timeout: 5_000,
    });
  }
  await atRest(page, TABLE_SCREEN);
}
