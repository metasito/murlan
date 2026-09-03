import { defineConfig, devices } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import os from "node:os";
import { writeFileSync } from "node:fs";

// This is the one place that knows both `baseURL` and the `webServer` command, so it is the one
// place that can hand a single port to the server, the health check and every spec at once.
//
// Run rather than imported: Playwright loads this config as CommonJS, which cannot `require`
// scripts/e2ePort.mjs. An explicit E2E_PORT still wins, so a proof can pin its own.
const PORT =
  process.env.E2E_PORT ??
  execFileSync(process.execPath, [resolve(__dirname, "../../scripts/e2ePort.mjs")], {
    encoding: "utf8",
  }).trim();
// Playwright loads this config once per process — the runner and every worker — and each load
// would otherwise pick a port of its own, leaving the workers pointed at a server the runner
// never started. Workers inherit this, so the first load decides for the whole run.
process.env.E2E_PORT = PORT;
const BASE_URL = `http://127.0.0.1:${PORT}`;
// A run whose server is not where the docs say it is has to be able to say where it is.
if (PORT !== "5199") console.log(`e2e: port 5199 is taken, serving on ${PORT}`);

// #893: the only way accountRecovery.spec.ts can get a raw verification or
// reset token — only its hash is stored server-side, and the real send goes
// to Resend. Tied to the port for the same reason PORT is: two runs on this
// machine must not share a file. Computed once and re-exported so every
// worker this config is loaded in reads the same path (see PORT above).
const MAIL_SINK = process.env.MURLAN_MAIL_SINK ?? resolve(os.tmpdir(), `murlan-e2e-mail-${PORT}.jsonl`);
// Truncated by the load that starts the server, never by a worker's — the file
// holds live credentials, and a run reading a previous run's leftovers would
// find a token for an account that no longer exists.
if (!process.env.MURLAN_MAIL_SINK) writeFileSync(MAIL_SINK, "");
process.env.MURLAN_MAIL_SINK = MAIL_SINK;

// Kept out of `npm test` (tests/**/*.test.ts) on purpose — this suite builds
// the Expo web bundle and drives a real browser against the real server, so
// it is much slower than the unit suite and needs Docker for the dev-stack
// database. Run explicitly via `npm run test:e2e`.
export default defineConfig({
  testDir: __dirname,
  globalSetup: resolve(__dirname, "../../scripts/preflightMemory.mjs"),
  // Recorded by `npm run perf:web` through playwright.perf.config.ts, never
  // here: frame timing on a shared runner is noisy, and a perf check that
  // goes red at random gets disabled and then lies (#118).
  testIgnore: /webPerf\.spec\.ts$/,
  outputDir: "test-results",
  // A default backstop only — every test sets its own budget explicitly
  // (larger player counts and multi-hand matches need more), since a real
  // played-to-completion game is genuinely slower with more seats.
  timeout: 10 * 60_000,
  fullyParallel: false,
  retries: 0,
  // One worker, and not for want of trying: the runner is already CPU-bound
  // with a single Chromium driving this bundle, so a second and third lane
  // divide the same cores rather than adding any. Three ran the suite in the
  // same 7.5 minutes and starved three tests past their own timeouts (#73).
  // The parallelism that does pay is `--shard`, one runner each, which
  // `.github/workflows/ci.yml` drives.
  workers: 1,
  // A shard's own HTML report covers a quarter of the suite, so CI emits the
  // intermediate form instead and `merge-reports` makes the one report the
  // workflow uploads. Locally there is nothing to merge.
  reporter: process.env.CI
    ? [["list"], ["blob", { outputDir: "blob-report" }]]
    : [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
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
    command: `node ${JSON.stringify(resolve(__dirname, "../../scripts/e2e-server.mjs"))}`,
    url: BASE_URL,
    // A stale server on this port — even one hours old, serving an old bundle
    // — answers the health check and gets adopted, so a run can pass having
    // exercised nothing. `E2E_SKIP_BUILD=1` (scripts/e2e-server.mjs) is the
    // explicit local fast path when a fresh server is genuinely not needed.
    reuseExistingServer: false,
    timeout: 3 * 60_000,
    env: {
      E2E_PORT: PORT,
      MURLAN_MAIL_SINK: MAIL_SINK,
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
