// tests/e2e/tableFit.spec.ts — the game table stays inside the screen.
//
// A side seat's card fan is deliberately wider than the column that holds it:
// it leans in over the felt the way a real player's hand does. That only works
// if the overflow points inward. It used to be centred, so half of it hung off
// the side of the screen — at every viewport, since the fan is a fixed size —
// taking the avatar and the player's name with it. Nothing in the unit suite
// can see that: it is a property of the laid-out box, so it is measured in a
// real browser here, next to the tap-target sweep for the same reason.
import { test, expect } from "@playwright/test";
import { openApp, startOfflineGame } from "./helpers/navigation";

const VIEWPORTS = [
  { name: "small phone landscape", width: 667, height: 375 },
  { name: "large phone landscape", width: 844, height: 390 },
  { name: "tablet landscape", width: 1112, height: 834 },
];

// Four seats is the only arrangement that fills both side columns, and two is
// the only one that fills neither — between them every side slot is exercised.
const SEATS = [4, 2] as const;

test.describe("the table fits the screen", () => {
  for (const vp of VIEWPORTS) {
    for (const playerCount of SEATS) {
      test(`${vp.name}, ${playerCount} players`, async ({ page, baseURL }) => {
        test.setTimeout(90_000);
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await openApp(page, baseURL!);
        await startOfflineGame(page, { playerCount, gameMode: "free_for_all" });
        await page.locator('[data-testid="game-table"]').waitFor({ timeout: 60_000 });
        await page.waitForTimeout(2_000);

        // Laid-out boxes only, and only ones nothing clips. An SVG's bounding
        // box can be far wider than the ink it paints, and a big hand's card
        // row is deliberately wider than the screen inside a horizontal
        // ScrollView — neither is visible overflow.
        const escaping = await page.evaluate((viewportWidth) => {
          const table = document.querySelector('[data-testid="game-table"]');
          if (!table) throw new Error("the table never rendered");
          const out: { label: string; left: number; right: number }[] = [];
          const isClipped = (el: Element) => {
            for (let a = el.parentElement; a && a !== table; a = a.parentElement) {
              if (getComputedStyle(a).overflowX !== "visible") return true;
            }
            return false;
          };

          for (const el of table.querySelectorAll("div")) {
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) continue;
            if (r.left >= -0.5 && r.right <= viewportWidth + 0.5) continue;
            if (isClipped(el)) continue;
            out.push({
              label: el.getAttribute("aria-label") ?? el.className ?? "div",
              left: Math.round(r.left),
              right: Math.round(r.right),
            });
          }
          return out;
        }, vp.width);

        expect(
          escaping,
          `these parts of the table render off the side of a ${vp.width}px screen: ` +
            escaping.map((e) => `${e.label} (${e.left}…${e.right})`).join("; ")
        ).toEqual([]);
      });
    }
  }
});
