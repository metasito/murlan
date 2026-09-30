// The table's plates against the lantern fixture's, on one stage (#1259 plan 5, D4).
import { test, expect } from "@playwright/test";
import { appAt, mockupAt, type PlatePaint, type Rect, type Stage } from "./helpers/mockupStage";
import { captureStateById, type CaptureState } from "../../lib/captureStates";
import { cardScale } from "../../components/cardFaceModel";

const HALF_PT = 0.5;
const ONE_PT = 1;
const TURN = '[data-testid="notice-turn"]';
const COUNT = '[data-testid="turn-chip-count"]';
const STAGES = [
  { name: "iPhone 16 Pro", width: 874, height: 402 },
  { name: "iPhone SE", width: 568, height: 320 },
];

/** Your turn over a pile, so the clock runs and the pill carries its count as `#turn.lit` does. */
const LIT_WITH_COUNT: CaptureState = { ...captureStateById("lamp-bottom")!, id: "lamp-bottom-pile", pile: true };

const shown = async (stage: Stage, selector: string, run?: string): Promise<PlatePaint> => {
  await expect.poll(async () => (await stage.plate(selector))?.opacity, { message: `${selector} fully shown`, timeout: 30_000 }).toBe(1);
  return (await stage.plate(selector, run))!;
};

/** Negative where the two overlap. */
const gap = (a: Rect, b: Rect) => Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w), b.y - (a.y + a.h), a.y - (b.y + b.h));

test("turn, lit: the viewer's turn pill is #turn.lit", async ({ browser, baseURL }) => {
  test.setTimeout(120_000);
  const mockup = await mockupAt(browser, "rest", 1000);
  const app = await appAt(browser, baseURL!, LIT_WITH_COUNT);
  await expect(app.page.locator(COUNT), "the lit pill's count").toBeVisible({ timeout: 30_000 });
  const want = await shown(mockup, "#turn.lit");
  const got = await shown(app, TURN);
  const wantCount = (await mockup.plate("#turn.lit", "#tclock"))!;
  const gotCount = (await app.plate(TURN, COUNT))!;
  await Promise.all([mockup.close(), app.close()]);

  expect.soft(got.edge, "the edge").toBe(want.edge);
  expect.soft(got.glow?.color, "the glow's colour").toBe(want.glow?.color);
  expect.soft(Math.abs((got.glow?.blur ?? 0) - want.glow!.blur), "the glow's blur, off the mockup's").toBeLessThanOrEqual(HALF_PT);
  expect.soft(got.ink, "the label's ink").toBe(want.ink);
  expect.soft(got.fontSize, "the label's size").toBeCloseTo(want.fontSize, 0);
  expect.soft(Math.abs(got.box.h - want.box.h), "the height, off the mockup's").toBeLessThanOrEqual(HALF_PT);
  expect.soft(Math.abs(got.box.w - want.box.w), `the width, ${got.box.w} against the mockup's ${want.box.w}`).toBeLessThanOrEqual(ONE_PT);
  expect.soft(gotCount.ink, "the count's ink").toBe(wantCount.ink);
  expect.soft(gotCount.fontSize, "the count's size").toBeCloseTo(wantCount.fontSize, 0);
});

test("turn, lit: the glow is a static shadow", async ({ browser, baseURL }) => {
  test.setTimeout(120_000);
  const app = await appAt(browser, baseURL!, LIT_WITH_COUNT);
  const first = await shown(app, TURN);
  const glows = [first.glow];
  for (const wait of [130, 240, 240, 280]) {
    // fixed wait on purpose: the glow sampled at uneven instants, so no loop's period divides them all
    await app.page.waitForTimeout(wait);
    glows.push((await app.plate(TURN))!.glow);
  }
  await app.close();
  expect(first.glow, "a lit pill glows").not.toBeNull();
  expect(glows, "the glow at 0, 130, 370, 610 and 890 ms").toEqual(glows.map(() => first.glow));
});

for (const phone of STAGES) {
  test(`turn fits its band: Besnik on move, in it-IT, clear of every neighbour by the mockup's gap — ${phone.name}`, async ({
    browser,
    baseURL,
  }) => {
    test.setTimeout(120_000);
    const mockup = await mockupAt(browser, "bomb", 100);
    const [wantTurn] = await mockup.boxes("#turn");
    const mockupGap = Math.min(
      ...(await Promise.all(["#combo", "#score", ".nm", ".ring"].map((s) => mockup.boxes(s, s === ".nm")))).flat().map((b) => gap(wantTurn, b))
    );
    await mockup.close();
    expect(mockupGap, "the mockup's #turn clears its neighbours").toBeGreaterThan(0);

    const app = await appAt(browser, baseURL!, captureStateById("lamp-left")!, phone);
    await expect(app.page.getByTestId("game-hud-stack")).toContainText("Turno di Besnik");
    const pill = (await shown(app, TURN)).box;
    const named = { hudCombo: '[data-testid="notice-hudCombo"]', score: '[data-testid="score-pill"]', name: '[data-testid="seat-name"]', ring: '[data-testid="seat-ring"]' };
    const neighbours = (
      await Promise.all(Object.entries(named).map(async ([what, s]) => (await app.boxes(s, what === "name")).map((b) => ({ what, b }))))
    ).flat();
    const clipped = await app.page.evaluate(
      (sel) => [...document.querySelector(sel)!.querySelectorAll("*")].some((n) => n.scrollWidth > n.clientWidth + 1),
      TURN
    );
    await app.close();

    expect(new Set(neighbours.map((n) => n.what)), "every kind of neighbour is on the table").toEqual(new Set(Object.keys(named)));
    const want = (mockupGap * cardScale(Math.min(phone.width, phone.height))) / cardScale(402);
    const nearest = neighbours.map((n) => ({ ...n, gap: gap(pill, n.b) })).sort((a, b) => a.gap - b.gap)[0];
    expect(
      nearest.gap,
      `the pill ${JSON.stringify(pill)} is ${nearest.gap.toFixed(1)} pt from a ${nearest.what} ${JSON.stringify(nearest.b)}; the mockup keeps ${want.toFixed(1)}`
    ).toBeGreaterThanOrEqual(want - HALF_PT);
    expect(clipped, "the label is cut short").toBe(false);
  });
}
