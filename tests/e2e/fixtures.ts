// Playwright fixture that turns any browser-reported error into a test
// failure. The unit suite exercises game logic in isolation; this is what
// actually renders the app and would have caught a crash or a silent freeze
// that only shows up in the DOM.
//
// A `console.error`, `console.warn`, an uncaught exception, or an unhandled
// promise rejection during a test all fail it — a React error boundary
// render, a "Rendered fewer hooks than expected" warning, or a red-box would
// all surface exactly this way and nowhere else.

import type { Page } from "@playwright/test";
import { test as base, expect } from "@playwright/test";

/**
 * The anonymous session probe (`GET /api/auth/me`) 401s by design for every
 * signed-out visitor — every offline test starts signed out. The browser
 * logs failed fetches as `console.error` regardless of whether the app
 * treats the response as an error; Chromium reports this one with no request
 * URL in the message text itself (just "Failed to load resource: the server
 * responded with a status of 401 (Unauthorized)"), so the failing resource's
 * URL has to come from the console message's own location instead.
 */
export function isExpectedNoise(text: string, url: string): boolean {
  return text.includes("401") && url.endsWith("/api/auth/me");
}

export interface ConsoleErrors {
  entries: string[];
}

/**
 * Wires up the same collection the `consoleErrors` fixture below returns, on
 * whatever page is handed in — for a spec that drives more than one page (an
 * extra browser context per seat, say) and needs every one of them watched,
 * not just the fixture's own.
 */
export function collectConsoleErrors(page: Page): ConsoleErrors {
  const entries: string[] = [];

  page.on("console", (msg) => {
    if (msg.type() !== "error" && msg.type() !== "warning") return;
    const text = msg.text();
    if (isExpectedNoise(text, msg.location().url)) return;
    entries.push(`console.${msg.type()}: ${text}`);
  });
  page.on("pageerror", (err) => {
    entries.push(`pageerror: ${err.message}\n${err.stack ?? ""}`);
  });
  page.on("crash", () => {
    entries.push("page crashed");
  });

  return { entries };
}

export const test = base.extend<{ consoleErrors: ConsoleErrors }>({
  consoleErrors: async ({ page }, use) => {
    // Cuts every Reanimated spring/timing duration to ~0 via the same
    // `prefers-reduced-motion` media query lib/accessibility.ts's
    // usePrefersReducedMotion already reads — no product code changes, no
    // env plumbing, just less real time spent waiting on animation frames.
    await page.emulateMedia({ reducedMotion: "reduce" });

    const collected = collectConsoleErrors(page);
    await use(collected);

    if (collected.entries.length > 0) {
      throw new Error(
        `Browser reported ${collected.entries.length} error(s)/warning(s) during the test:\n\n` +
          collected.entries.map((e, i) => `[${i + 1}] ${e}`).join("\n\n")
      );
    }
  },
});

export { expect };
