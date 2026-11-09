import { defineConfig, devices } from "@playwright/test";
import { resolve } from "node:path";
import os from "node:os";
import { writeFileSync } from "node:fs";
import { localGlobalTimeoutMs } from "../../tools/ci/e2eGlobalTimeout.mjs";
import { CHECK_BASH_TIMEOUT_MS } from "../../tools/loop/limits.mjs";
import { E2E_VOTE_DEADLINE_MS } from "./helpers/voteDeadline";
import { NIGHTLY, PERF } from "./tiers.mjs";

// #893: the only way accountRecovery.spec.ts can get a raw verification or
// reset token — only its hash is stored server-side, and the real send goes
// to Resend. Tied to the process that loads this config first, so two runs on
// this machine do not share a file. Computed once and re-exported so every
// worker this config is loaded in reads the same path.
const MAIL_SINK = process.env.MURLAN_MAIL_SINK ?? resolve(os.tmpdir(), `murlan-e2e-mail-${process.pid}.jsonl`);
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
  globalSetup: resolve(__dirname, "../../tools/ci/preflightMemory.mjs"),
  // Recorded by `npm run perf:web` through playwright.perf.config.ts, never
  // here: frame timing on a shared runner is noisy, and a perf check that
  // goes red at random gets disabled and then lies (#118).
  testIgnore: [PERF, NIGHTLY],
  outputDir: "test-results",
  // A default backstop only — every test sets its own budget explicitly
  // (larger player counts and multi-hand matches need more), since a real
  // played-to-completion game is genuinely slower with more seats.
  timeout: 10 * 60_000,
  globalTimeout: localGlobalTimeoutMs(process.env, CHECK_BASH_TIMEOUT_MS),
  fullyParallel: false,
  // A blocking spec gets no retry anywhere: a race that passes on a second try still ships.
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
    ? [["list"], ["blob", { outputDir: "blob-report" }], [resolve(__dirname, "../../tools/ci/e2e-budget.mjs")], [resolve(__dirname, "../../tools/ci/results-playwright-reporter.mjs")]]
    : [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  forbidOnly: !!process.env.CI,
  use: {
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
    // The server binds PORT=0 and says where (scripts/e2e-server.mjs); Playwright puts the port it
    // captures in E2E_PORT, which the `baseURL` fixture reads (tests/e2e/fixtures.ts).
    wait: { stdout: /express server ready on port (?<e2e_port>\d+)/ },
    timeout: 3 * 60_000,
    env: {
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
      MURLAN_BOT_MOVE_DELAY_MS: "200",
      MURLAN_VOTE_DEADLINE_MS: String(E2E_VOTE_DEADLINE_MS),
    },
    stdout: "pipe",
    stderr: "pipe",
  },
});
