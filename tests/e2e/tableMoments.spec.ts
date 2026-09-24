// tests/e2e/tableMoments.spec.ts — #1102's four table moments, sampled live:
// the lamp comes up with the deal, an opponent's hand ramps in as it lands, a
// flown card's raised shadow drops once it is down, and a won partita dusts gold.
import { test, expect, type Page } from "@playwright/test";
import { openApp } from "./helpers/navigation";
import { offlineGameSave, resumeSaved } from "./helpers/offlineSeed";
import { buildCombination, targetsFor, type Card } from "../../lib/game/gameEngine";
import { GIOCA_VALID_LABEL } from "./helpers/labels";
import { TABLE, HAND_ZONE } from "./helpers/selectors";
import { tap } from "./helpers/press";
import { settled } from "./helpers/settle";
import { OFFLINE_SAVE_KEY } from "../../lib/storageKeys";

const VIEWPORT = { width: 874, height: 402 };
const LEFT_SEAT_HAND = 13;

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
  const save: any = offlineGameSave(4, LEFT_SEAT_HAND, 0);
  save.gameState.firstPlayMade = false;
  await page.addInitScript(
    ({ key, value }) => window.localStorage.setItem(key, value),
    { key: OFFLINE_SAVE_KEY, value: JSON.stringify(save) }
  );
  await openApp(page, baseURL);
  const resume = page.getByRole("button", { name: "Riprendi partita" });
  await resume.waitFor({ state: "visible", timeout: 60_000 });

  const windowMs = 2_200;
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
    ).toBeLessThan(LEFT_SEAT_HAND);

    const dealt = frames[frames.length - 1];
    expect(dealt.leftCount, "the opponent's hand never finishes arriving").toBe(String(LEFT_SEAT_HAND));

    await test.info().attach("opponent-deal-arrived.png", {
      body: await page.screenshot(),
      contentType: "image/png",
    });
  });
});

// ─── Flight shadow ──────────────────────────────────────────────────────────

const PILE_CARD: Card = { id: "3_clubs", rank: "3", suit: "clubs", isJoker: false };
const BEATER: Card = { id: "8_hearts", rank: "8", suit: "hearts", isJoker: false };
const SPARE: Card = { id: "4_clubs", rank: "4", suit: "clubs", isJoker: false };
/** Loses to `BEATER`, so the bot passes rather than throwing a second flight into the sample window. */
const BOT_CARD: Card = { id: "5_spades", rank: "5", suit: "spades", isJoker: false };
const BEATER_LABEL = "8 di Cuori";

function flightSave(): object {
  return {
    version: 2,
    gameState: {
      players: [
        { id: "player_0", name: "Ana", hand: [BEATER, SPARE], type: "human" },
        { id: "player_1", name: "Bea", hand: [BOT_CARD], type: "ai" },
      ],
      currentTurnIndex: 0,
      lastPlayedCombination: buildCombination([PILE_CARD]),
      lastPlayedBy: 1,
      passCount: 0,
      gameMode: "free_for_all",
      roundWinner: null,
      gameOver: false,
      rankings: [],
      firstPlayMade: true,
    },
    match: { length: "single", target: 21, scores: {}, hands: [], over: false, winners: [], isDraw: false },
    rematchAnswers: {},
    players: [
      { name: "Ana", type: "human" },
      { name: "Bea", type: "ai", personality: "luan" },
    ],
    gameMode: "free_for_all",
    dealFirstSeat: 0,
  };
}

interface ShadowFrame {
  t: number;
  opacity: number | null;
}

async function watchShadow(page: Page, windowMs: number): Promise<void> {
  await page.evaluate((windowMs) => {
    const state = { frames: [] as ShadowFrame[], done: false };
    (window as unknown as { __shadow: typeof state }).__shadow = state;
    const started = performance.now();
    const step = () => {
      const shadow = document.querySelector('[data-testid="flying-shadow-lifted"]');
      state.frames.push({
        t: performance.now() - started,
        opacity: shadow ? Number(getComputedStyle(shadow).opacity) : null,
      });
      if (performance.now() - started < windowMs) requestAnimationFrame(step);
      else state.done = true;
    };
    requestAnimationFrame(step);
  }, windowMs);
}

async function readShadow(page: Page, windowMs: number): Promise<ShadowFrame[]> {
  await page.waitForFunction(
    () => (window as unknown as { __shadow?: { done: boolean } }).__shadow?.done === true,
    undefined,
    { timeout: windowMs * 2 + 15_000 }
  );
  return page.evaluate(() => (window as unknown as { __shadow: { frames: ShadowFrame[] } }).__shadow.frames);
}

test.describe("flight shadow", () => {
  test("a played card's raised shadow drops once it lands", async ({ page, baseURL }) => {
    test.setTimeout(60_000);
    await page.setViewportSize(VIEWPORT);
    await resumeSaved(page, baseURL!, flightSave());
    await settled(page, 1_500, TABLE);

    const beater = page.locator(HAND_ZONE).getByRole("button", { name: BEATER_LABEL, exact: true });
    await tap(page, beater);
    const gioca = page.getByTestId("btn-gioca");
    await expect(gioca).toHaveAttribute("aria-label", GIOCA_VALID_LABEL, { timeout: 10_000 });

    const windowMs = 900;
    await watchShadow(page, windowMs);
    await tap(page, gioca);
    const frames = await readShadow(page, windowMs);

    const lifted = frames.find((f) => f.opacity !== null && f.opacity > 0.5);
    expect(lifted, "the shadow never lifted off the felt during the throw").toBeTruthy();

    const landed = frames[frames.length - 1];
    expect(
      landed.opacity === null || landed.opacity < 0.05,
      "the raised shadow never gave way to the card's own resting one"
    ).toBeTruthy();

    await test.info().attach("flight-shadow-landed.png", {
      body: await page.screenshot(),
      contentType: "image/png",
    });
  });
});

/** The viewer one card and one point short of the partita, so throwing `BEATER` wins it. */
function partitaPointSave(): object {
  const save: any = flightSave();
  const target = targetsFor(2)[0];
  save.gameState.players[0].hand = [BEATER];
  save.match = { ...save.match, length: "match", target, scores: { player_0: target - 1, player_1: 0 } };
  return save;
}

test.describe("partita gold dust", () => {
  test("winning the partita dusts gold behind the trophy", async ({ page, baseURL }) => {
    test.setTimeout(60_000);
    await page.setViewportSize(VIEWPORT);
    await resumeSaved(page, baseURL!, partitaPointSave());
    await settled(page, 1_500, TABLE);

    await tap(page, page.locator(HAND_ZONE).getByRole("button", { name: BEATER_LABEL, exact: true }));
    const gioca = page.getByTestId("btn-gioca");
    await expect(gioca).toHaveAttribute("aria-label", GIOCA_VALID_LABEL, { timeout: 10_000 });
    await tap(page, gioca);

    await expect(page).toHaveURL(/\/result/, { timeout: 20_000 });
    await expect(page.getByTestId("gold-flake").first()).toBeAttached({ timeout: 10_000 });
    expect(await page.getByTestId("gold-flake").count(), "the gold dust fell short of its flakes").toBe(24);

    await test.info().attach("partita-gold-dust.png", {
      body: await page.screenshot(),
      contentType: "image/png",
    });
  });
});
