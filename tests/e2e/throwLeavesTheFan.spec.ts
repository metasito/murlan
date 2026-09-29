import { test, expect } from "./fixtures";
import { installVirtualClock, step, takeOver } from "./helpers/virtualClock";
import { belowCapsTable, botMove } from "./helpers/mockupParity";

const badgeOf = async (page: import("@playwright/test").Page) =>
  Object.fromEntries(
    await page.locator('[data-testid="seat-card-count"]').evaluateAll((els) =>
      els.map((e) => [Math.round(e.getBoundingClientRect().x), Number(e.textContent)])
    )
  ) as Record<string, number>;

test("an opponent's throw leaves its fan on the throw's first frame, and nothing of it is drawn twice", async ({ page, baseURL }) => {
  await installVirtualClock(page, 1259);
  await belowCapsTable(page, baseURL!);
  await takeOver(page);
  const before = await badgeOf(page);
  const backsBefore = await page.locator('[data-testid="seat-back"]').count();
  expect(backsBefore, "the seed is below the caps: every card is a drawn back").toBe(Object.values(before).reduce((a, b) => a + b, 0));
  await botMove(page);
  let n = 0;
  for (let f = 0; f < 40; f++) {
    await step(page);
    if (n === 0) n = await page.locator('[data-testid="flying-card"]').count();
    if (n === 0) continue;
    const after = await badgeOf(page);
    const dropped = Object.keys(before).filter((k) => after[k] !== before[k]);
    expect(dropped.length, `frame ${f}: exactly one seat's count changed`).toBe(1);
    expect(before[dropped[0]] - after[dropped[0]], `frame ${f}: the count dropped by the play at the throw`).toBe(n);
    expect(await page.locator('[data-testid="seat-back-departing"]').count(), `frame ${f}: a departing back beside the face card`).toBe(0);
    expect(await page.locator('[data-testid="seat-back"]').count(), `frame ${f}: the fans draw exactly the post-throw counts`).toBe(backsBefore - n);
  }
  expect(n, "the throw was traced").toBeGreaterThan(0);
});
