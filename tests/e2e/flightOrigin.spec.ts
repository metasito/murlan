import { test, expect } from "./fixtures";
import { installVirtualClock, step, takeOver } from "./helpers/virtualClock";
import { belowCapsTable, botMove, pairsTable } from "./helpers/mockupParity";
import { GIOCA_VALID_LABEL } from "./helpers/labels";

const centre = (b: { x: number; y: number; width: number; height: number }) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

test("a thrown card's first frame is where the viewer last saw it", async ({ page, baseURL }) => {
  await installVirtualClock(page, 1259);
  await pairsTable(page, baseURL!);
  await takeOver(page);
  const hand = page.locator('[data-hand-state] [data-testid="card-box"]');
  await hand.nth(0).click({ force: true, position: { x: 8, y: 30 } });
  await hand.nth(1).click({ force: true, position: { x: 8, y: 30 } });
  await step(page);
  const before = [centre((await hand.nth(0).boundingBox())!), centre((await hand.nth(1).boundingBox())!)];
  await page.getByRole("button", { name: GIOCA_VALID_LABEL }).click({ force: true });
  await step(page);
  const flying = page.locator('[data-testid="flying-card"]');
  await expect(flying).toHaveCount(2);
  for (let i = 0; i < 2; i++) {
    const at = centre((await flying.nth(i).boundingBox())!);
    expect(Math.hypot(at.x - before[i].x, at.y - before[i].y), `card ${i} starts in its own hand slot`).toBeLessThanOrEqual(2);
  }
});

const fanBoxes = async (page: import("@playwright/test").Page) => {
  const backs = await page.locator('[data-testid="seat-back"]').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()));
  const width = page.viewportSize()!.width;
  const side = (x: number) => (x < width / 3 ? "left" : x > (2 * width) / 3 ? "right" : "top");
  const fans = new Map<string, { x0: number; y0: number; x1: number; y1: number; n: number }>();
  for (const b of backs) {
    const k = side(b.x + b.width / 2);
    const f = fans.get(k) ?? { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, n: 0 };
    fans.set(k, { x0: Math.min(f.x0, b.x), y0: Math.min(f.y0, b.y), x1: Math.max(f.x1, b.x + b.width), y1: Math.max(f.y1, b.y + b.height), n: f.n + 1 });
  }
  return fans;
};

test("an opponent's thrown card's first frame is its fan's centre, not its ring's, below the cap", async ({ page, baseURL }) => {
  await installVirtualClock(page, 1259);
  await belowCapsTable(page, baseURL!);
  await takeOver(page);
  const badges = (await page.locator('[data-testid="seat-card-count"]').allTextContents()).map(Number).sort();
  const drawn = [...(await fanBoxes(page)).values()].map((f) => f.n).sort();
  expect(drawn, "every fan draws its whole count: the seed is below the caps").toEqual(badges);
  await botMove(page);
  await step(page);
  const first = centre((await page.locator('[data-testid="flying-card"]').first().boundingBox())!);
  const fans = await fanBoxes(page);
  const nearest = Math.min(...[...fans.values()].map((f) => Math.hypot(first.x - (f.x0 + f.x1) / 2, first.y - (f.y0 + f.y1) / 2)));
  expect(nearest, "the throw starts at its fan's centre, as drawn on the throw's frame").toBeLessThanOrEqual(2);
});

test("on its first frame the flier paints above the hand slot and the fan it leaves", async ({ page, baseURL }) => {
  await installVirtualClock(page, 1259);
  await belowCapsTable(page, baseURL!);
  await takeOver(page);
  await botMove(page);
  await step(page);
  const flier = page.locator('[data-testid="flying-card"]').first();
  const clip = (await flier.boundingBox())!;
  const shown = await page.screenshot({ clip });
  await flier.evaluate((e) => ((e as HTMLElement).style.visibility = "hidden"));
  const hidden = await page.screenshot({ clip });
  await flier.evaluate((e) => ((e as HTMLElement).style.visibility = ""));
  expect(shown.equals(hidden), "hiding the flier changed nothing: something paints over it").toBe(false);
});
