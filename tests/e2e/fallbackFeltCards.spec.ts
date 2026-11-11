// tests/e2e/fallbackFeltCards.spec.ts — what a lamp aim costs the web table while the felt is still
// the fallback canvas (#1988 items 11 and 16): no card view restyles, yet the cast still follows the
// lamp; and a large window's felt bakes once per place the lamp aims, however many times it returns.
import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";
import { offlineSave, resumeSaved } from "./helpers/offlineSeed";
import { settled } from "./helpers/settle";
import { shadowLayers } from "./helpers/cardContact";
import { countRenders, startRenderCounts, TAKE_RENDER_COUNTS, type RenderCounts } from "./helpers/renderCounters";
import { OFFLINE_SAVE_KEY } from "../../lib/storageKeys";

const HAND = 8;

async function seatedTable(page: Page, baseURL: string) {
  await resumeSaved(page, baseURL, offlineSave({ seats: 4, hand: HAND, turn: 1 }), { holdTurn: true });
  await settled(page, 3_000, '[data-testid="game-table"]');
  await expect(page.locator('[data-testid="felt-fallback"]')).toHaveCount(1);
}

/** Plays the seat on move, and returns once the save has `next` on move. */
async function act(page: Page, hook: "murlanBotMove" | "murlanPass", next: number) {
  await page.evaluate((hook) => (globalThis as unknown as Record<string, () => void>)[hook](), hook);
  await expect
    .poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).gameState.currentTurnIndex, OFFLINE_SAVE_KEY))
    .toBe(next);
}

interface Layer {
  x: number;
  y: number;
}

/** The cast `game-root` holds, and each hand card's inline and computed shadow, its computed layers parsed. */
async function readTable(page: Page) {
  const { cast, cards } = await page.evaluate(() => {
    const root = document.querySelector<HTMLElement>('[data-testid="game-root"]')!;
    const rootStyle = getComputedStyle(root);
    const cast = { x: parseFloat(rootStyle.getPropertyValue("--card-cast-x")), y: parseFloat(rootStyle.getPropertyValue("--card-cast-y")) };
    const cards = [...document.querySelectorAll<HTMLElement>('[data-testid^="hand-card-"] [data-testid="card-box"]')].map((box) => ({
      inline: box.style.boxShadow,
      computed: getComputedStyle(box).boxShadow,
    }));
    return { cast, cards };
  });
  return { cast, cards: cards.map((c) => ({ ...c, layers: shadowLayers(c.computed).map(({ x, y }) => ({ x, y })) })) };
}

function expectCastAt(cards: { computed: string; layers: Layer[] }[], cast: Layer) {
  expect(cards.length).toBeGreaterThanOrEqual(HAND);
  for (const { computed, layers } of cards) {
    expect(computed).not.toBe("none");
    expect(layers).toHaveLength(2);
    const [contact, fall] = layers;
    expect(contact.x).toBe(0);
    expect(contact.y).toBeGreaterThan(0);
    expect(fall.x).toBeCloseTo(cast.x, 2);
    expect(fall.y).toBeCloseTo(cast.y, 2);
  }
}

test("a lamp aim restyles no card view, and the cast still follows it", async ({ page, baseURL }) => {
  test.setTimeout(90_000);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize({ width: 874, height: 402 });
  await seatedTable(page, baseURL!);
  const before = await readTable(page);
  expect(Number.isFinite(before.cast.x) && Number.isFinite(before.cast.y)).toBe(true);
  expectCastAt(before.cards, before.cast);
  await act(page, "murlanBotMove", 0);
  await expect.poll(async () => (await readTable(page)).cast).not.toEqual(before.cast);
  const after = await readTable(page);
  expect(after.cards.map((c) => c.inline)).toEqual(before.cards.map((c) => c.inline));
  expectCastAt(after.cards, after.cast);
});

test("a large window's felt bakes once per place the lamp aims", async ({ browser, baseURL }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2, reducedMotion: "no-preference" });
  try {
    const page = await context.newPage();
    await countRenders(page);
    await seatedTable(page, baseURL!);
    await startRenderCounts(page);
    /** Cloth drawn off the page since the last read, once the felt has drawn its new aim and stopped. */
    const bakes = async () => {
      let offscreen = 0;
      let drawn = false;
      await expect
        .poll(async () => {
          const { draws } = await page.evaluate<RenderCounts>(TAKE_RENDER_COUNTS);
          const felt = draws["felt-fallback 2d"] ?? 0;
          offscreen += draws.offscreen ?? 0;
          const quiet = drawn && felt === 0 && !draws.offscreen;
          drawn ||= felt > 0;
          return quiet;
        }, { intervals: [250] })
        .toBe(true);
      return offscreen;
    };
    const firstVisits: number[] = [];
    for (const [hook, next] of [["murlanBotMove", 0], ["murlanPass", 3], ["murlanBotMove", 2]] as const) {
      await act(page, hook, next);
      firstVisits.push(await bakes());
    }
    await act(page, "murlanBotMove", 1);
    const back = await bakes();
    console.log(`cloth draws: seats 0, 3, 2 ${firstVisits.join(", ")}; back at seat 1 ${back}`);
    expect(firstVisits.every((n) => n > 0)).toBe(true);
    expect(back).toBe(0);
  } finally {
    await context.close();
  }
});
