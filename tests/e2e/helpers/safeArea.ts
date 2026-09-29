import type { Page } from "@playwright/test";

/**
 * Overrides the safe-area probe's padding, so the app reads the insets a landscape iPhone reports.
 * On web react-native-safe-area-context appends a hidden probe div with `padding-*:
 * env(safe-area-inset-*)`, the only element whose inline style names `safe-area-inset-left`, and
 * reports its computed padding on the `transitionend` of its own 0.05s padding transition — the
 * same path a notched iPhone takes, not a mock.
 */
export async function setSafeArea(page: Page, left: number, bottom: number, right: number): Promise<void> {
  await page.evaluate(
    ({ left, bottom, right }) => {
      const id = "e2e-safe-area";
      document.getElementById(id)?.remove();
      const style = document.createElement("style");
      style.id = id;
      style.textContent =
        `div[style*="safe-area-inset-left"] {` +
        ` padding-left: ${left}px !important;` +
        ` padding-right: ${right}px !important;` +
        ` padding-bottom: ${bottom}px !important; }`;
      document.head.appendChild(style);
    },
    { left, bottom, right }
  );
  await page.waitForTimeout(600);
}
