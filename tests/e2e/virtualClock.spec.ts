import { test, expect } from "@playwright/test";
import { animationPhase, installVirtualClock, step, stepThen, takeOver } from "./helpers/virtualClock.ts";
import { STEP_MS } from "./helpers/traceDiff.ts";

const PAGE = `<!doctype html><style>
@keyframes slide { from { transform: translateX(0) } to { transform: translateX(1000px) } }
.late { animation: slide 10s linear both }
.held { animation: slide 10s linear both paused }
</style><div id="box"></div>`;

const start = async (page: import("@playwright/test").Page, cls: string) => {
  await installVirtualClock(page, 1);
  await page.setContent(PAGE);
  await takeOver(page);
  await page.evaluate((cls) => document.getElementById("box")!.classList.add(cls), cls);
  await step(page, 0);
};

test("a CSS animation created after install advances exactly STEP_MS per step", async ({ page }) => {
  await start(page, "late");
  expect(await animationPhase(page)).toEqual([{ name: "slide", currentTime: 0 }]);
  for (let i = 1; i <= 5; i++) {
    await step(page);
    expect(await animationPhase(page), `after ${i} steps`).toEqual([{ name: "slide", currentTime: i * STEP_MS }]);
  }
  await stepThen(page, STEP_MS, "0");
  expect(await animationPhase(page)).toEqual([{ name: "slide", currentTime: 6 * STEP_MS }]);
});

test("a paused CSS animation holds its phase across steps", async ({ page }) => {
  await start(page, "held");
  for (let i = 0; i < 3; i++) await step(page);
  await stepThen(page, STEP_MS, "0");
  expect(await animationPhase(page)).toEqual([{ name: "slide", currentTime: 0 }]);
});
