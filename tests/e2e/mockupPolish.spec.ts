// The table's plates against the lantern fixture's, on one stage (#1259 plan 5, D4).
import { test, expect } from "@playwright/test";
import { appAt, mockupAt, type PlatePaint, type Stage } from "./helpers/mockupStage";
import { captureStateById } from "../../lib/captureStates";

const HALF_PT = 0.5;
const TURN = '[data-testid="notice-turn"]';

const shown = async (stage: Stage, selector: string): Promise<PlatePaint> => {
  await expect.poll(async () => (await stage.plate(selector))?.opacity, { message: `${selector} fully shown`, timeout: 30_000 }).toBe(1);
  return (await stage.plate(selector))!;
};

test("turn, lit: the viewer's turn pill is #turn.lit", async ({ browser, baseURL }) => {
  test.setTimeout(120_000);
  const mockup = await mockupAt(browser, "rest", 1000);
  const app = await appAt(browser, baseURL!, captureStateById("lamp-bottom")!);
  const want = await shown(mockup, "#turn.lit");
  const got = await shown(app, TURN);
  await Promise.all([mockup.close(), app.close()]);

  expect.soft(got.edge, "the edge").toBe(want.edge);
  expect.soft(got.glow?.color, "the glow's colour").toBe(want.glow?.color);
  expect.soft(Math.abs((got.glow?.blur ?? 0) - want.glow!.blur), "the glow's blur, off the mockup's").toBeLessThanOrEqual(HALF_PT);
  expect.soft(got.ink, "the label's ink").toBe(want.ink);
  expect.soft(got.fontSize, "the label's size").toBeCloseTo(want.fontSize, 0);
  expect.soft(Math.abs(got.box.h - want.box.h), "the height, off the mockup's").toBeLessThanOrEqual(HALF_PT);
});

test("turn, lit: the glow is a static shadow", async ({ browser, baseURL }) => {
  test.setTimeout(120_000);
  const app = await appAt(browser, baseURL!, captureStateById("lamp-bottom")!);
  const first = await shown(app, TURN);
  // fixed wait on purpose: the same glow read twice, apart in time
  await app.page.waitForTimeout(700);
  const later = (await app.plate(TURN))!;
  await app.close();
  expect(first.glow, "a lit pill glows").not.toBeNull();
  expect(later.glow, "the glow 700 ms on").toEqual(first.glow);
});

test("turn fits its band: Besnik on move, in it-IT", async ({ browser, baseURL }) => {
  test.setTimeout(120_000);
  const app = await appAt(browser, baseURL!, captureStateById("lamp-left")!);
  const stack = app.page.getByTestId("game-hud-stack");
  await expect(stack).toContainText("Turno di Besnik");
  const pill = await shown(app, TURN);
  const band = (await stack.boundingBox())!;
  const clipped = await app.page.evaluate(
    (sel) => [...document.querySelector(sel)!.querySelectorAll("*")].some((n) => n.scrollWidth > n.clientWidth + 1),
    TURN
  );
  await app.close();

  expect(pill.box.x, "the pill's left edge").toBeGreaterThanOrEqual(band.x - HALF_PT);
  expect(pill.box.x + pill.box.w, "the pill's right edge").toBeLessThanOrEqual(band.x + band.width + HALF_PT);
  expect(pill.box.y, "the pill's top").toBeGreaterThanOrEqual(band.y - HALF_PT);
  expect(pill.box.y + pill.box.h, "the pill's bottom").toBeLessThanOrEqual(band.y + band.height + HALF_PT);
  expect(clipped, "the label is cut short").toBe(false);
});
