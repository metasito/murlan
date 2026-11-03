// The perf recorder runs on its own config so the default suite can ignore it.
//
// It is deliberately not part of `npm run test:e2e`: frame timing on a shared
// runner is noisy — see #152 for how much this one's *functional* timeouts
// already vary — and a perf check that goes red at random gets disabled, after
// which it reads as coverage that is not there (#118).
//
// `PERF_URL` measures a server already running instead of the e2e build: a
// production export (no `EXPO_PUBLIC_E2E_FAST`), so the bots think at the pace a
// player sees. Without it the recorder boots the e2e stack like every other spec.
import { defineConfig } from "@playwright/test";
import base from "./playwright.config.ts";

const served = process.env.PERF_URL;

export default defineConfig({
  ...base,
  testIgnore: undefined,
  testMatch: /webPerf\.spec\.ts$/,
  ...(served ? { use: { ...base.use, baseURL: served }, webServer: undefined } : {}),
});
