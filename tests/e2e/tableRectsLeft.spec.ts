// tests/e2e/tableRectsLeft.spec.ts — "Play on the left" is drawn where `tableRects` says; its own file so
// tableRects.spec.ts stays inside one shard's budget.
import { test, expect } from "./fixtures";
import { offlineSave } from "./helpers/offlineSeed";
import { PHONES } from "./helpers/phones";
import { INSETS } from "../helpers/phoneTable";
import { DRAWN } from "./helpers/drawnRects";
import { check, open } from "./helpers/tableRectsCheck";
import { catalogs } from "../../shared/i18n";
import { gameTable, TABLETS } from "../helpers/tableScenes";

const SIXTEEN = PHONES.find((p) => p.name === "iPhone 16 Pro")!;
const ISLAND = INSETS["62/21/62"];
const ANA_AND_BESNIKS = ["Ana", "Besnik", "Besnik", "Besnik"];

test.describe("play on the left is drawn in the solver's rects", () => {
  for (const vp of [SIXTEEN, TABLETS[0]]) {
    const insets = vp === SIXTEEN ? ISLAND : INSETS["0/0"];
    test(`GIOCA on the left: ${vp.name}`, async ({ page, baseURL }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width: vp.width, height: vp.height });
      const save = offlineSave({ seats: 4, hand: 13, turn: 0, names: ANA_AND_BESNIKS });
      await open(page, baseURL!, save, "it", insets);
      const knob = page.getByRole("button", { name: catalogs.it["gameTable.settingsA11yLabel"] });
      await knob.click();
      await page.getByRole("switch", { name: catalogs.it["gameSettingsSheet.playOnLeft"] }).click();
      await knob.click();
      await expect(page.getByTestId("settings-sheet")).toHaveCount(0);
      await check(page, `${vp.name}, play on the left`, vp, insets, "it", gameTable(save.gameState), undefined, true, undefined, DRAWN, true);
    });
  }
});
