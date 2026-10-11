// The mockup-parity specs playwright.config.ts ignores, run by .github/workflows/parity-nightly.yml.
import { defineConfig } from "@playwright/test";
import base from "./playwright.config.ts";

export default defineConfig({
  ...base,
  testIgnore: /(^|\/)webPerf\.spec\.ts$/,
  testMatch: /(^|\/)(mockupParity\w*|feltParityGrid(Phone|Tablet)[234]|cardShadowParity|cardGlowParity|handParity|lampLegibility|lampSeats|mockupPolish)\.spec\.ts$/,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
});
