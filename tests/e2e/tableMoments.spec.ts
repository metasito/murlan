// tests/e2e/tableMoments.spec.ts — #1102's table moments, sampled live: the
// lamp comes up with the deal, an opponent's hand ramps in as it lands, and a
// won match turns the score pill into the board.
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { openApp } from "./helpers/navigation";
import { offlineSave, oneCardFromFinishing, resumeSaved, seedSave } from "./helpers/offlineSeed";
import type { Card } from "../../lib/game/gameEngine";
import { expectSelectionLegal } from "./helpers/bot.ts";
import { TABLE, HAND_ZONE } from "./helpers/selectors";
import { tap } from "./helpers/press";
import { settled } from "./helpers/settle";
import { Motion } from "../../lib/tokens";
import { STEP_MS } from "./helpers/traceDiff";

const VIEWPORT = { width: 874, height: 402 };
const SEAT_HAND = 13;

interface EntryFrame {
  t: number;
  level: number | null;
  leftCount: string | null;
}

async function watchEntry(page: Page, windowMs: number): Promise<void> {
  await page.evaluate((windowMs) => {
    const state = { frames: [] as EntryFrame[], done: false };
    (window as unknown as { __entry: typeof state }).__entry = state;
    const trace = (window as unknown as { murlanTrace: { start(): void; frames: { lamp: { level: number | null } | null }[] } }).murlanTrace;
    trace.start();
    const started = performance.now();
    const step = () => {
      const count = document.querySelector(
        '[data-testid="side-seat-left"] [data-testid="seat-card-count"]'
      );
      state.frames.push({
        t: performance.now() - started,
        level: trace.frames.at(-1)?.lamp?.level ?? null,
        leftCount: count ? count.textContent : null,
      });
      if (performance.now() - started < windowMs) requestAnimationFrame(step);
      else state.done = true;
    };
    requestAnimationFrame(step);
  }, windowMs);
}

async function readEntry(page: Page, windowMs: number): Promise<EntryFrame[]> {
  await page.waitForFunction(
    () => (window as unknown as { __entry?: { done: boolean } }).__entry?.done === true,
    undefined,
    { timeout: windowMs * 2 + 15_000 }
  );
  return page.evaluate(() => (window as unknown as { __entry: { frames: EntryFrame[] } }).__entry.frames);
}

/** A fresh, undealt hand — the state `GameTable`'s own `freshDeal` arms on. */
async function openFreshTable(page: Page, baseURL: string): Promise<EntryFrame[]> {
  await seedSave(page, offlineSave({ seats: 4, hand: SEAT_HAND, fresh: true }));
  await openApp(page, baseURL);
  const resume = page.getByRole("button", { name: "Riprendi partita" });
  await resume.waitFor({ state: "visible", timeout: 60_000 });

  const windowMs = 3_000;
  await watchEntry(page, windowMs);
  await resume.click();
  return readEntry(page, windowMs);
}

test.describe("table entry", () => {
  test("the lamp comes up from 75% as the table is dealt", async ({ page, baseURL }) => {
    test.setTimeout(60_000);
    await page.setViewportSize(VIEWPORT);
    const frames = await openFreshTable(page, baseURL!);

    const opening = frames.find((f) => f.level !== null)!;
    expect(opening, "the lamp never rendered").toBeTruthy();
    expect(opening.level, "the lamp opens already at full").toBeLessThan(0.8);

    const rest = frames[frames.length - 1];
    expect(rest.level, "the lamp never comes up to full").toBeGreaterThan(0.97);

    const traced = await page.evaluate(() =>
      (window as unknown as { murlanTrace: { frames: { t: number; onsets: string[]; breath?: number }[] } }).murlanTrace.frames
    );
    const breaths = traced.map((f) => f.breath ?? 1);
    expect(Math.max(...breaths), "the felt never breathed").toBeGreaterThan(1.003);
    expect(breaths.at(-1), "the felt is still swollen at rest").toBe(1);
    const dealt = traced.flatMap((f) => f.onsets.filter((o) => o === "moment:dealt").map(() => f.t));
    expect(dealt, "one landing per card in your hand").toHaveLength(SEAT_HAND);
    expect(dealt.at(-1)! - dealt[0], "your cards land one after another, 42 ms apart").toBeGreaterThanOrEqual(
      (SEAT_HAND - 1) * Motion.stagger.deal - 2 * STEP_MS
    );

    await test.info().attach("table-entry-settled.png", {
      body: await page.screenshot(),
      contentType: "image/png",
    });
  });
});

test.describe("opponent deal", () => {
  test("the left seat's hand count ramps up to the dealt count as it arrives", async ({ page, baseURL }) => {
    test.setTimeout(60_000);
    await page.setViewportSize(VIEWPORT);
    const frames = await openFreshTable(page, baseURL!);

    const opening = frames.find((f) => f.leftCount !== null)!;
    expect(opening, "the left seat's badge never rendered").toBeTruthy();
    expect(
      Number(opening.leftCount),
      "the opponent's hand is already full on the first frame"
    ).toBeLessThan(SEAT_HAND);

    const dealt = frames[frames.length - 1];
    expect(dealt.leftCount, "the opponent's hand never finishes arriving").toBe(String(SEAT_HAND));

    await test.info().attach("opponent-deal-arrived.png", {
      body: await page.screenshot(),
      contentType: "image/png",
    });
  });
});

// ─── A match won on the felt ────────────────────────────────────────────────

const PILE_CARD: Card = { id: "3_clubs", rank: "3", suit: "clubs", isJoker: false };
const BEATER: Card = { id: "8_hearts", rank: "8", suit: "hearts", isJoker: false };
const BEATER_LABEL = "8 di Cuori";

test.describe("a match won on the felt", () => {
  test("winning the match turns the score pill into the board, on the table", async ({ page, baseURL }) => {
    test.setTimeout(60_000);
    await page.setViewportSize(VIEWPORT);
    await resumeSaved(page, baseURL!, oneCardFromFinishing({ seats: 2, length: "match", last: BEATER, pile: [PILE_CARD] }));
    await settled(page, 1_500, TABLE);

    await tap(page, page.locator(HAND_ZONE).getByRole("button", { name: BEATER_LABEL, exact: true }));
    const gioca = page.getByTestId("btn-gioca");
    await expectSelectionLegal(page, "the seeded beater over the seeded pile is a legal play");
    await tap(page, gioca);

    await expect(page.getByTestId("btn-new-match")).toBeVisible({ timeout: 20_000 });
    await expect(page).toHaveURL(/\/game/);
    await expect(page.getByTestId("match-winner-name")).toHaveText("Ana");
    await expect(page.getByText("Hai vinto")).toBeVisible();

    await test.info().attach("match-board.png", {
      body: await page.screenshot(),
      contentType: "image/png",
    });
  });
});
