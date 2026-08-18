import { defineConfig, devices } from "@playwright/test";

const PORT = process.env.E2E_PORT ?? "5199";
const BASE_URL = `http://127.0.0.1:${PORT}`;

// Kept out of `npm test` (tests/**/*.test.ts) on purpose — this suite builds
// the Expo web bundle and drives a real browser against the real server, so
// it is much slower than the unit suite and needs Docker for the dev-stack
// database. Run explicitly via `npm run test:e2e`.
export default defineConfig({
  testDir: __dirname,
  outputDir: "test-results",
  // A default backstop only — every test sets its own budget explicitly
  // (larger player counts and multi-hand matches need more), since a real
  // played-to-completion game is genuinely slower with more seats.
  timeout: 10 * 60_000,
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL: BASE_URL,
    // Italian is the UI's source-of-truth language (locales/it.ts) and the
    // language every selector in this suite is written against — pinning it
    // makes the run deterministic regardless of the host machine's own
    // locale, which would otherwise steer the app to whichever of it/en/sq
    // best matches the CI environment.
    locale: "it-IT",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: `node ${JSON.stringify(require("path").resolve(__dirname, "../../scripts/e2e-server.mjs"))}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 3 * 60_000,
    env: {
      E2E_PORT: PORT,
      // The server defaults this to 5s under E2E so nothing waits on it. That
      // is shorter than socket.io's own reconnect backoff, so a client that
      // drops would have its seat vacated before it could possibly return —
      // which makes the reconnect path untestable rather than fast. 30s is
      // still well under production's 60s and only ever elapses in a test that
      // deliberately stays offline.
      MURLAN_DISCONNECT_GRACE_MS: "30000",
      // Must exceed CARD_CLICK_TIMEOUT_MS (tests/e2e/helpers/bot.ts) times the
      // largest card combination the driver builds — selecting cards is
      // client-side and never resets this timer, so a selection sequence that
      // outruns it gets auto-passed mid-selection.
      MURLAN_AFK_TIMEOUT_MS: "30000",
    },
    stdout: "pipe",
    stderr: "pipe",
  },
});
