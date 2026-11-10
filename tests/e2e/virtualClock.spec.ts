import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";
import { animationPhase, installVirtualClock, step, stepThen, takeOver } from "./helpers/virtualClock.ts";
import { STEP_MS } from "./helpers/traceDiff.ts";

const PAGE = `<!doctype html><style>
@keyframes slide { from { transform: translateX(0) } to { transform: translateX(1000px) } }
.late { animation: slide 10s linear both }
.held { animation: slide 10s linear both paused }
</style><div id="box"></div>`;

const start = async (page: Page, baseURL: string, cls: string) => {
  await installVirtualClock(page, 1);
  await page.goto(`${baseURL}/metadata.json`);
  await page.setContent(PAGE);
  await takeOver(page);
  await page.evaluate((cls) => document.getElementById("box")!.classList.add(cls), cls);
  await step(page, 0);
};

test("a CSS animation created after install advances exactly STEP_MS per step", async ({ page, baseURL }) => {
  await start(page, baseURL!, "late");
  expect(await animationPhase(page)).toEqual([{ name: "slide", currentTime: 0 }]);
  for (let i = 1; i <= 5; i++) {
    await step(page);
    expect(await animationPhase(page), `after ${i} steps`).toEqual([{ name: "slide", currentTime: i * STEP_MS }]);
  }
  await stepThen(page, STEP_MS, "0");
  expect(await animationPhase(page)).toEqual([{ name: "slide", currentTime: 6 * STEP_MS }]);
});

test("a paused CSS animation holds its phase across steps", async ({ page, baseURL }) => {
  await start(page, baseURL!, "held");
  for (let i = 0; i < 3; i++) await step(page);
  await stepThen(page, STEP_MS, "0");
  expect(await animationPhase(page)).toEqual([{ name: "slide", currentTime: 0 }]);
});

const steppers: [string, (page: Page) => Promise<unknown>][] = [
  ["step", (page) => step(page)],
  ["stepThen", (page) => stepThen(page, STEP_MS, "0")],
  ["murlanStep, the in-page loops' step", (page) => page.evaluate((ms) => window.murlanStep(ms), STEP_MS)],
];

for (const [name, advance] of steppers) {
  test(`an animation a timer creates during ${name} has not yet been advanced by it`, async ({ page, baseURL }) => {
    await installVirtualClock(page, 1);
    await page.goto(`${baseURL}/metadata.json`);
    await page.setContent(PAGE);
    await takeOver(page);
    await page.evaluate(() => setTimeout(() => document.getElementById("box")!.classList.add("late"), 1));
    await advance(page);
    const [created] = await animationPhase(page);
    expect(created.currentTime).toBeGreaterThanOrEqual(0);
    expect(created.currentTime).toBeLessThan(STEP_MS);
    await advance(page);
    expect((await animationPhase(page))[0].currentTime).toBe(STEP_MS);
  });
}

test("an animation heavy page costs the Animation domain no event per step", async ({ page, baseURL }) => {
  await installVirtualClock(page, 1);
  await page.goto(`${baseURL}/metadata.json`);
  const frames = Array.from({ length: 300 }, (_, i) => `${(i / 299) * 100}%{transform:translateX(${i}px)}`).join("");
  await page.setContent(
    `<!doctype html><style>@keyframes heavy{${frames}}div{animation:heavy 300s linear both}</style>${"<div></div>".repeat(20)}`
  );
  await takeOver(page);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Animation.enable");
  let updates = 0;
  cdp.on("Animation.animationUpdated", () => updates++);
  await step(page);
  const settled = updates;
  for (let i = 0; i < 10; i++) await step(page);
  expect(updates - settled, `${updates - settled} animationUpdated events over 10 steps of 20 animations`).toBe(0);
  expect((await animationPhase(page))[0].currentTime).toBe(11 * STEP_MS);
});

test("an animation that a step carries to its end still finishes", async ({ page, baseURL }) => {
  await installVirtualClock(page, 1);
  await page.goto(`${baseURL}/metadata.json`);
  await page.setContent(`${PAGE}<style>.short { animation: slide ${STEP_MS * 3}ms linear both }</style>`);
  await takeOver(page);
  await page.evaluate(() => {
    (window as unknown as { ended: number }).ended = 0;
    const box = document.getElementById("box")!;
    box.addEventListener("animationend", () => (window as unknown as { ended: number }).ended++);
    box.classList.add("short");
  });
  for (let i = 0; i < 5; i++) await step(page);
  // The event is queued for the next real frame, which no step waits on.
  await expect.poll(() => page.evaluate(() => (window as unknown as { ended: number }).ended)).toBe(1);
});
