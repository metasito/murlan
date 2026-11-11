// tests/e2e/fallbackFeltCards.spec.ts — what a lamp aim costs the web table while the felt is still
// the fallback canvas (#1988 items 11 and 16): no card view restyles, yet the cast still follows the
// lamp; and a large window's felt bakes once per place the lamp aims, however many times it returns.
import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";
import { offlineSave, resumeSaved } from "./helpers/offlineSeed";
import { settled } from "./helpers/settle";
import { countRenders, startRenderCounts, TAKE_RENDER_COUNTS, type RenderCounts } from "./helpers/renderCounters";
import { OFFLINE_SAVE_KEY } from "../../lib/storageKeys";

const HAND = 8;
const BAKE_MS = 1_500;

async function seatedTable(page: Page, baseURL: string) {
  await resumeSaved(page, baseURL, offlineSave({ seats: 4, hand: HAND, turn: 1 }), { holdTurn: true });
  await settled(page, 3_000, '[data-testid="game-table"]');
  await expect(page.locator('[data-testid="felt-fallback"]')).toHaveCount(1);
}

/** Plays the seat to act, then the seat the save says acts next. */
async function act(page: Page, hook: "murlanBotMove" | "murlanPass"): Promise<number> {
  await page.evaluate((hook) => (globalThis as unknown as Record<string, () => void>)[hook](), hook);
  // fixed wait on purpose: neither the lamp's new aim nor its bake leaves anything on the page to wait for
  await page.waitForTimeout(BAKE_MS);
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).gameState.currentTurnIndex, OFFLINE_SAVE_KEY);
}

test("a lamp aim restyles no card view, and the cast still follows it", async ({ page, baseURL }) => {
  test.setTimeout(90_000);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize({ width: 874, height: 402 });
  await seatedTable(page, baseURL!);
  const shadows = () =>
    page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('[data-testid^="hand-card-"] [data-testid="card-box"]')].map((box) => ({
        inline: box.style.boxShadow,
        computed: getComputedStyle(box).boxShadow,
      }))
    );
  const before = await shadows();
  expect(before.length).toBeGreaterThanOrEqual(HAND);
  expect(await act(page, "murlanBotMove")).toBe(0);
  const after = await shadows();
  expect(after.map((s) => s.inline)).toEqual(before.map((s) => s.inline));
  expect(after.map((s) => s.computed)).not.toEqual(before.map((s) => s.computed));
});

test("a large window's felt bakes once per place the lamp aims", async ({ browser, baseURL }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2, reducedMotion: "no-preference" });
  const page = await context.newPage();
  await countRenders(page);
  await seatedTable(page, baseURL!);
  await startRenderCounts(page);
  const bakes = async () => (await page.evaluate<RenderCounts>(TAKE_RENDER_COUNTS)).draws.offscreen ?? 0;
  const firstVisits: number[] = [];
  for (const [hook, next] of [["murlanBotMove", 0], ["murlanPass", 3], ["murlanBotMove", 2]] as const) {
    expect(await act(page, hook)).toBe(next);
    firstVisits.push(await bakes());
  }
  expect(await act(page, "murlanBotMove")).toBe(1);
  const back = await bakes();
  console.log(`cloth draws: seats 0, 3, 2 ${firstVisits.join(", ")}; back at seat 1 ${back}`);
  expect(firstVisits.every((n) => n > 0)).toBe(true);
  expect(back).toBe(0);
  await context.close();
});
