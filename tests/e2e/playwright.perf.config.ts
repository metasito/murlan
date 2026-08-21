// The perf recorder runs on its own config so the default suite can ignore it.
//
// It is deliberately not part of `npm run test:e2e`: frame timing on a shared
// runner is noisy — see #152 for how much this one's *functional* timeouts
// already vary — and a perf check that goes red at random gets disabled, after
// which it reads as coverage that is not there (#118).
import { defineConfig } from "@playwright/test";
import base from "./playwright.config.ts";

export default defineConfig({
  ...base,
  testIgnore: undefined,
  testMatch: /webPerf\.spec\.ts$/,
});
