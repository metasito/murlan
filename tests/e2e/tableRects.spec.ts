// tests/e2e/tableRects.spec.ts — the table is drawn where `tableRects` says, on the viewports, safe
// areas and languages the pure property test walks. The pure test cannot see flexbox; this is what
// ties the solver to it.
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { DEAL_SIZE, exchangeSave, offlineSave, resumeOnVirtualClock, seedSave } from "./helpers/offlineSeed";
import { installVirtualClock, stepUntil } from "./helpers/virtualClock";
import { openApp } from "./helpers/navigation";
import { openOnlineTable } from "./helpers/onlineTable";
import { PHONES } from "./helpers/phones";
import { setSafeArea } from "./helpers/safeArea";
import { INSETS } from "../helpers/phoneTable";
import { DRAWN, drawn, misfits, RAIL, settled } from "./helpers/drawnRects";
import { captureGameState, captureStateById, type CaptureState } from "../../lib/captureStates";
import { createDeck, type Card } from "../../lib/game/gameEngine";
import type { OfflineSave } from "../../lib/offlineSave";
import { LOCALE_KEY } from "../../lib/storageKeys";
import { catalogs, type Locale } from "../../shared/i18n";
import { USERNAME_MAX } from "../../shared/username";
import type { EdgeInsets } from "../../components/tableFrame";
import { brokenRules, tableRects } from "../../components/tableRects";
import { drawnChips, gameTable, TABLETS, type DrawnTable } from "../helpers/tableScenes";

const VIEWPORTS = [...PHONES, ...TABLETS];
const PHONE_INSETS = Object.entries(INSETS);
const LOCALES: readonly Locale[] = ["it", "en", "sq"];
const STATES: readonly CaptureState[] = ["held", "pile-right", "bomb-landed"].map((id) => captureStateById(id)!);

async function open(page: Page, baseURL: string, save: OfflineSave, locale: Locale, insets: EdgeInsets) {
  await seedSave(page, save, { holdTurn: true });
  await page.addInitScript(([key, value]) => window.localStorage.setItem(key, value), [LOCALE_KEY, locale]);
  await openApp(page, baseURL);
  await page.getByRole("button", { name: catalogs[locale]["home.resumeGame"] }).click({ timeout: 60_000 });
  await expect(page.getByTestId("hand-zone")).toBeVisible({ timeout: 30_000 });
  await setSafeArea(page, insets.left, insets.bottom, insets.right, insets.top);
}

async function check(page: Page, where: string, vp: { width: number; height: number }, insets: EdgeInsets, locale: Locale, table: DrawnTable, exchangeName?: string, keepsRules = false, exchangeCards?: { received: Card; given: Card }, rects = DRAWN) {
  const got = await settled(page, rects);
  const chips = drawnChips(table, locale, got.texts, exchangeName, exchangeCards);
  expect(chips, `${where}: the pills read words a scene says (${got.texts.combo} | ${got.texts.turn} | ${got.texts.note})`).toEqual({ combo: expect.anything(), turn: expect.anything(), note: got.texts.note === "" ? null : expect.anything() });
  const solved = tableRects({ width: vp.width, height: vp.height, insets, locale, state: { ...table.base, chips: { combo: chips.combo!, turn: chips.turn!, note: chips.note ?? undefined } } });
  expect(misfits(got, solved, rects), where).toEqual([]);
  if (keepsRules) expect(brokenRules(solved), `${where}: the solved table breaks its rules`).toEqual([]);
}

for (const [v, vp] of VIEWPORTS.entries())
  test(`the table is drawn in the solver's rects: ${vp.name}`, async ({ page, baseURL }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: vp.width, height: vp.height });
    for (const [i, locale] of LOCALES.entries()) {
      const capture = STATES[(i + v) % STATES.length];
      const [inset, insets] = PHONES.some((p) => p.name === vp.name) ? PHONE_INSETS[(i + v) % PHONE_INSETS.length] : PHONE_INSETS[0];
      const save = offlineSave({ seats: capture.playerCount, hand: DEAL_SIZE[capture.playerCount], turn: capture.turn });
      await open(page, baseURL!, { ...save, gameState: captureGameState(capture) }, locale, insets);
      await check(page, `${vp.name}, ${inset}, ${locale}, ${capture.id}`, vp, insets, locale, gameTable(captureGameState(capture)));
    }
  });

const SIXTEEN = PHONES.find((p) => p.name === "iPhone 16 Pro")!;
const SE = PHONES.find((p) => p.name === "iPhone SE")!;
const ISLAND = INSETS["62/21/62"];
/** Every seat one name, so the exchange's pills read words `exchangeScenes` says. */
const EXCHANGE_NAME = "Besnik";
/** A straight of every face on the felt, and the biggest hand a deal gives, beside it. */
const STRAIGHT_13 = ["A_hearts", "2_spades", "3_hearts", "4_spades", "5_hearts", "6_spades", "7_hearts", "8_spades", "9_hearts", "10_spades", "J_hearts", "Q_spades", "K_hearts"];

test.describe("the table at its limits is drawn in the solver's rects", () => {
  for (const vp of [SE, SIXTEEN, TABLETS[1]]) {
    const insets = vp === SIXTEEN ? ISLAND : INSETS["0/0"];
    test(`an exchange: ${vp.name}`, async ({ page, baseURL }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width: vp.width, height: vp.height });
      const save = exchangeSave({ seats: 3, hand: DEAL_SIZE[3], winner: 0, loser: 1, names: [EXCHANGE_NAME, EXCHANGE_NAME, EXCHANGE_NAME] });
      await open(page, baseURL!, save, "it", insets);
      await expect(page.getByTestId("exchange-prompt"), "the winner's hand lifts once the exchange asks").toBeVisible({ timeout: 15_000 });
      await check(page, `${vp.name}, exchange`, vp, insets, "it", gameTable(save.gameState), EXCHANGE_NAME);
    });

    test(`an exchange's note under the pile: ${vp.name}`, async ({ page, baseURL }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await installVirtualClock(page, 1833);
      await page.addInitScript(([key, value]) => window.localStorage.setItem(key, value), [LOCALE_KEY, "it"]);
      const save = exchangeSave({ seats: 3, hand: DEAL_SIZE[3], winner: 0, loser: 1, names: [EXCHANGE_NAME, EXCHANGE_NAME, EXCHANGE_NAME] });
      await resumeOnVirtualClock(page, baseURL!, save);
      await stepUntil(page, () => page.getByTestId("exchange-pill-note").isVisible(), "the received card resting on the pile", { chunkMs: 100 });
      let before = "";
      await stepUntil(
        page,
        async () => {
          const now = JSON.stringify(await drawn(page, DRAWN));
          const still = now === before && (await page.getByTestId("exchange-pill-note").isVisible());
          before = now;
          return still;
        },
        "the table at rest under the note",
        { chunkMs: 100 }
      );
      const phase = save.gameState.exchangePhase;
      if (phase?.kind !== "open") throw new Error("the save opens no exchange");
      const dealt = gameTable(save.gameState);
      // The received card rests on the pile, so the hand draws one fewer than the state holds.
      const resting: DrawnTable = { ...dealt, base: { ...dealt.base, hand: { ...dealt.base.hand, cards: dealt.base.hand.cards - 1 } } };
      await check(page, `${vp.name}, the note under the pile`, vp, INSETS["0/0"], "it", resting, EXCHANGE_NAME, false, { received: phase.cardFromLoser, given: phase.cardFromLoser });
    });

    test(`a thirteen-card straight over an eighteen-card hand: ${vp.name}`, async ({ page, baseURL }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width: vp.width, height: vp.height });
      const free = createDeck().map((c) => c.id).filter((id) => !STRAIGHT_13.includes(id));
      const save = offlineSave({ seats: 3, holding: [free.slice(0, 18), free.slice(18, 29), free.slice(29, 40)], pile: { cards: STRAIGHT_13, by: 2 } });
      await open(page, baseURL!, save, "sq", insets);
      await check(page, `${vp.name}, pile 13, hand 18`, vp, insets, "sq", gameTable(save.gameState));
    });
  }
});

test.describe("the chip row bounds the turn chip's name", () => {
  for (const vp of [SE, SIXTEEN]) {
    test(`an account's longest name on the move: ${vp.name}`, async ({ page, baseURL }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width: vp.width, height: vp.height });
      const insets = vp === SIXTEEN ? ISLAND : INSETS["0/0"];
      const name = "W".repeat(USERNAME_MAX);
      const save = offlineSave({ seats: 3, hand: DEAL_SIZE[3], turn: 1, names: ["Ana", name, name] });
      await open(page, baseURL!, save, "sq", insets);
      await check(page, `${vp.name}, longest name on the move`, vp, insets, "sq", gameTable(save.gameState));
    });
  }
});

const ANA_AND_BESNIKS = ["Ana", "Besnik", "Besnik", "Besnik"];
const STRAIGHT_12 = STRAIGHT_13.slice(0, 12);

test.describe("the side seats and the hand are drawn in the solver's rects, and keep its rules", () => {
  for (const vp of [PHONES[0], PHONES[1], PHONES[3], TABLETS[0]]) {
    for (const [turn, hand] of [[1, "off its turn"], [0, "on its turn"]] as const)
      test(`full seats, hand ${hand}: ${vp.name}`, async ({ page, baseURL }) => {
        test.setTimeout(120_000);
        const insets = INSETS["0/0"];
        await page.setViewportSize({ width: vp.width, height: vp.height });
        const save = offlineSave({ seats: 4, hand: 13, turn, names: ANA_AND_BESNIKS });
        await open(page, baseURL!, save, "en", insets);
        await check(page, `${vp.name}, hand ${hand}`, vp, insets, "en", gameTable(save.gameState), undefined, true);
      });
  }

  for (const vp of TABLETS)
    test(`a twelve-card straight between the side fans: ${vp.name}`, async ({ page, baseURL }) => {
      test.setTimeout(120_000);
      const insets = INSETS["0/0"];
      await page.setViewportSize({ width: vp.width, height: vp.height });
      const free = createDeck().map((c) => c.id).filter((id) => !STRAIGHT_12.includes(id));
      const save = offlineSave({ seats: 4, holding: [0, 10, 20, 30].map((from) => free.slice(from, from + 10)), pile: { cards: STRAIGHT_12, by: 2 }, names: ANA_AND_BESNIKS });
      await open(page, baseURL!, save, "en", insets);
      await check(page, `${vp.name}, pile 12`, vp, insets, "en", gameTable(save.gameState), undefined, true);
    });
});

test("the rail's knobs are drawn in the solver's rects: online", async ({ browser, baseURL }) => {
  test.setTimeout(240_000);
  const table = await openOnlineTable(browser, baseURL!, { playerCount: 2, gameMode: "free_for_all", viewport: { width: SIXTEEN.width, height: SIXTEEN.height } });
  try {
    const got = await settled(table.page, RAIL);
    const solved = tableRects({ width: SIXTEEN.width, height: SIXTEEN.height, insets: INSETS["0/0"], locale: "it", state: { seats: { top: null, left: null, right: null }, hand: { cards: 0, onTurn: false, faceDown: false }, pile: 0, chips: { combo: [], turn: [] } } });
    expect(misfits(got, solved, RAIL), "iPhone 16 Pro, online").toEqual([]);
  } finally {
    await table.close();
  }
});

