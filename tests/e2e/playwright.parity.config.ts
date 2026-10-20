// The specs playwright.config.ts ignores as nightly, run by .github/workflows/parity-nightly.yml.
import { defineConfig } from "@playwright/test";
import base from "./playwright.config.ts";
import { NIGHTLY, PERF } from "./tiers.mjs";

export default defineConfig({
  ...base,
  testIgnore: PERF,
  testMatch: NIGHTLY,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
});
