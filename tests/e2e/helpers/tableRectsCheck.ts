// The open-and-compare steps both tableRects specs share: the table is drawn where `tableRects` says.
import type { Page } from "@playwright/test";
import { expect } from "../fixtures";
import { seedSave } from "./offlineSeed";
import { openApp } from "./navigation";
import { setSafeArea } from "./safeArea";
import { DRAWN, misfits, settled } from "./drawnRects";
import type { OfflineSave } from "../../../lib/offlineSave";
import type { Card } from "../../../lib/game/gameEngine";
import { LOCALE_KEY } from "../../../lib/storageKeys";
import { catalogs, type Locale } from "../../../shared/i18n";
import type { EdgeInsets } from "../../../components/tableFrame";
import { brokenRules, tableRects } from "../../../components/tableRects";
import { drawnChips, type DrawnTable } from "../../helpers/tableScenes";

export async function open(page: Page, baseURL: string, save: OfflineSave, locale: Locale, insets: EdgeInsets) {
  await seedSave(page, save, { holdTurn: true });
  await page.addInitScript(([key, value]) => window.localStorage.setItem(key, value), [LOCALE_KEY, locale]);
  await openApp(page, baseURL);
  await page.getByRole("button", { name: catalogs[locale]["home.resumeGame"] }).click({ timeout: 60_000 });
  await expect(page.getByTestId("hand-zone")).toBeVisible({ timeout: 30_000 });
  await setSafeArea(page, insets.left, insets.bottom, insets.right, insets.top);
}

export async function check(page: Page, where: string, vp: { width: number; height: number }, insets: EdgeInsets, locale: Locale, table: DrawnTable, exchangeName?: string, keepsRules = false, exchangeCards?: { received: Card; given?: Card }, rects = DRAWN, playOnLeft = false) {
  const got = await settled(page, rects);
  const chips = drawnChips(table, locale, got.texts, exchangeName, exchangeCards);
  expect(chips, `${where}: the pills read words a scene says (${got.texts.combo} | ${got.texts.turn} | ${got.texts.note})`).toEqual({ combo: expect.anything(), turn: expect.anything(), note: got.texts.note === "" ? null : expect.anything() });
  const solved = tableRects({ width: vp.width, height: vp.height, insets, locale, playOnLeft, state: { ...table.base, chips: { combo: chips.combo!, turn: chips.turn!, note: chips.note ?? undefined } } });
  expect(misfits(got, solved, rects), where).toEqual([]);
  if (keepsRules) expect(brokenRules(solved), `${where}: the solved table breaks its rules`).toEqual([]);
  return { got, solved };
}
