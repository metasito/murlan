// Playwright fixture that turns any browser-reported error into a test
// failure. The unit suite exercises game logic in isolation; this is what
// actually renders the app and would have caught a crash or a silent freeze
// that only shows up in the DOM.
//
// A `console.error`, `console.warn`, an uncaught exception, or an unhandled
// promise rejection during a test all fail it — a React error boundary
// render, a "Rendered fewer hooks than expected" warning, or a red-box would
// all surface exactly this way and nowhere else.

import type { BrowserContext, Page } from "@playwright/test";
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
  return (text.includes("401") && url.endsWith("/api/auth/me")) || READBACK_NOISE.test(text);
}

// SwiftShader's own: a bare WebGL canvas, with no app, logs it too (#1257).
const READBACK_NOISE =
  /^\[\.WebGL-0x[0-9a-f]+\]GL Driver Message \(OpenGL, Performance, GL_CLOSE_PATH_NV, High\): GPU stall due to ReadPixels( \(this message will no longer repeat\))?$/;

export interface ConsoleErrors {
  entries: string[];
}

/**
 * Wires up the same collection the `consoleErrors` fixture below returns, on
 * whatever page is handed in — for a spec that drives more than one page (an
 * extra browser context per seat, say) and needs every one of them watched,
 * not just the fixture's own.
 */
export function collectConsoleErrors(page: Page, entries: string[] = []): ConsoleErrors {
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

const watched = new WeakSet<BrowserContext>();

function watchContext(context: BrowserContext, entries: string[]): void {
  if (watched.has(context)) return;
  watched.add(context);
  for (const page of context.pages()) collectConsoleErrors(page, entries);
  context.on("page", (page) => collectConsoleErrors(page, entries));
}

export const test = base.extend<{ browserErrors: ConsoleErrors; consoleErrors: ConsoleErrors }>({
  // Every test, every page it opens: the `context` fixture's, and any from `browser.newContext`
  // or `browser.newPage` (which goes through `newContext`). No media emulation here — parity,
  // flight and timing specs measure real motion.
  browserErrors: [
    async ({ browser }, use) => {
      const entries: string[] = [];
      const newContext = browser.newContext;
      browser.newContext = async (...args) => {
        const context = await newContext.apply(browser, args);
        watchContext(context, entries);
        return context;
      };
      try {
        await use({ entries });
      } finally {
        browser.newContext = newContext;
      }

      if (entries.length > 0) {
        throw new Error(
          `Browser reported ${entries.length} error(s)/warning(s) during the test:\n\n` +
            entries.map((e, i) => `[${i + 1}] ${e}`).join("\n\n")
        );
      }
    },
    { auto: true },
  ],
  context: async ({ context, browserErrors }, use) => {
    watchContext(context, browserErrors.entries);
    await use(context);
  },
  consoleErrors: async ({ page, browserErrors }, use) => {
    // Cuts every Reanimated spring/timing duration to ~0 via the same
    // `prefers-reduced-motion` media query lib/accessibility.ts's
    // usePrefersReducedMotion already reads — no product code changes, no
    // env plumbing, just less real time spent waiting on animation frames.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await use(browserErrors);
  },
});

export { expect };
