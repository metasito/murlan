import type { Page } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, expect } from "./fixtures";

const REDUCED = "(prefers-reduced-motion: reduce)";

async function plant(page: Page, kind: "error" | "warn"): Promise<void> {
  await Promise.all([page.waitForEvent("console"), page.evaluate((k) => console[k]("planted"), kind)]);
}

const PLANTED = `
  import type { Page } from "@playwright/test";
  import { test } from ${JSON.stringify(path.join(__dirname, "fixtures"))};
  const plant = (page: Page, kind: "error" | "warn") => Promise.all([page.waitForEvent("console"), page.evaluate((k) => console[k]("planted"), kind)]);
  test("on the page fixture", async ({ page }) => { await plant(page, "error"); });
  test("on a page of a context the spec opened", async ({ browser }) => {
    const context = await browser.newContext();
    await plant(await context.newPage(), "warn");
    await context.close();
  });
  test("on a page the browser opened directly", async ({ browser }) => {
    const page = await browser.newPage();
    await Promise.all([page.waitForEvent("pageerror"), page.evaluate(() => { void Promise.reject(new Error("planted")); })]);
    await page.close();
  });
  test("on a clean page", async ({ page }) => { await page.evaluate(() => console.log("not an error")); });
`;

type Spec = { title: string; tests: { results: { status: string; error?: { message?: string } }[] }[] };

test("a browser error fails the test, on every page: the real fixtures, run by a real runner", () => {
  test.setTimeout(90_000);
  const dir = mkdtempSync(path.join(tmpdir(), "browser-errors-"));
  writeFileSync(path.join(dir, "planted.spec.ts"), PLANTED);
  writeFileSync(path.join(dir, "pw.config.mjs"), `export default { testDir: ".", retries: 0, workers: 1, reporter: [["json"]] };\n`);
  // The outer run's results file and worker identity would otherwise reach the planted run.
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (/^(TEST_|PW_|MURLAN_TEST_RESULTS$)/.test(k)) delete env[k];
  const cli = createRequire(__filename).resolve("@playwright/test/cli");
  const ran = spawnSync(process.execPath, [cli, "test", "--config", path.join(dir, "pw.config.mjs")], { cwd: dir, env, encoding: "utf8", timeout: 80_000 });
  expect(ran.status, ran.stderr).toBe(1);
  const specs: Spec[] = (JSON.parse(ran.stdout).suites as { specs: Spec[] }[]).flatMap((s) => s.specs);
  const outcome = Object.fromEntries(specs.map((s) => [s.title, s.tests[0]!.results.map((r) => `${r.status}: ${r.error?.message?.split("\n")[0] ?? ""}`)]));
  const failed = ["failed: Error: Browser reported 1 error(s)/warning(s) during the test:"];
  expect(outcome).toEqual({
    "on the page fixture": failed,
    "on a page of a context the spec opened": failed,
    "on a page the browser opened directly": failed,
    "on a clean page": ["passed: "],
  });
});

test("each error is collected once, on every page", async ({ page, browser, browserErrors }) => {
  await plant(page, "error");
  const context = await browser.newContext();
  await plant(await context.newPage(), "warn");
  expect(browserErrors.entries).toEqual(["console.error: planted", "console.warning: planted"]);
  browserErrors.entries.length = 0;
  await context.close();
});

test("a clean page passes", async ({ page }) => {
  await Promise.all([page.waitForEvent("console"), page.evaluate(() => console.log("not an error"))]);
});

test("reduced motion is left alone without consoleErrors", async ({ page }) => {
  expect(await page.evaluate((q) => matchMedia(q).matches, REDUCED)).toBe(false);
});

test("consoleErrors still emulates reduced motion", async ({ page, consoleErrors }) => {
  expect(await page.evaluate((q) => matchMedia(q).matches, REDUCED)).toBe(true);
  expect(consoleErrors.entries).toEqual([]);
});
