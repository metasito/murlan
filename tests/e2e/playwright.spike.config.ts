import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: __dirname,
  testMatch: /zzSwaySpike\.spec\.ts$/,
  timeout: 15 * 60_000,
  workers: 1,
  reporter: "line",
  use: { baseURL: process.env.SPIKE_URL ?? "http://127.0.0.1:8099" },
});
