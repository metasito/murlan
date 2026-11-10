// tests/e2e/tableRectsBadges.spec.ts — a seat's reconnecting and vacated badges are drawn where
// `tableRects` solves them, on a table of three real accounts.
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { openOnlineTable } from "./helpers/onlineTable";
import { PHONES } from "./helpers/phones";
import { BADGES, misfits, settled } from "./helpers/drawnRects";
import { INSETS } from "../helpers/phoneTable";
import { tableRects } from "../../components/tableRects";
import { TABLETS } from "../helpers/tableScenes";

const SIXTEEN = PHONES.find((p) => p.name === "iPhone 16 Pro")!;
const SE = PHONES.find((p) => p.name === "iPhone SE")!;

test.describe("a seat's badge is drawn in the solver's rects: online", () => {
  const SIDES = { top: '[data-testid="top-seat"]', left: '[data-testid="side-seat-left"]', right: '[data-testid="side-seat-right"]' } as const;

  /** The seats as the page draws them: who sits, and the badge each wears with the seconds it counts. */
  const seated = (page: Page) =>
    page.evaluate((sides) => {
      const out: Record<string, { name: string; badge?: { kind: "vacated" } | { kind: "reconnecting"; seconds: number } }> = {};
      for (const [dir, sel] of Object.entries(sides)) {
        const seat = document.querySelector(sel);
        const name = seat?.querySelector('[data-testid="seat-name"]')?.textContent;
        if (!seat || !name) continue;
        const wait = seat.querySelector('[data-testid="notice-reconnecting"]')?.textContent?.match(/\d+/)?.[0];
        out[dir] = { name, badge: wait ? { kind: "reconnecting", seconds: Number(wait) } : seat.querySelector('[data-testid="notice-vacated"]') ? { kind: "vacated" } : undefined };
      }
      return out;
    }, SIDES);

  test("reconnecting, then vacated, on a phone, a bigger phone and a tablet", async ({ browser, baseURL }) => {
    test.setTimeout(300_000);
    const sizes = [SE, SIXTEEN, TABLETS[0]];
    const table = await openOnlineTable(browser, baseURL!, { playerCount: 3, gameMode: "free_for_all", viewport: { width: SE.width, height: SE.height } });
    try {
      await table.others[0].context().setOffline(true);
      for (const kind of ["reconnecting", "vacated"] as const) {
        await expect(table.page.getByTestId(`notice-${kind}`), `a seat is ${kind}`).toBeVisible({ timeout: 90_000 });
        for (const vp of sizes) {
          await table.page.setViewportSize({ width: vp.width, height: vp.height });
          const got = await settled(table.page, BADGES);
          const seats = await seated(table.page);
          const badged = Object.values(seats).filter((seat) => seat.badge?.kind === kind);
          expect(badged, `${vp.name}: the ${kind} badge is on one seat`).toHaveLength(1);
          const solved = tableRects({
            width: vp.width,
            height: vp.height,
            insets: INSETS["0/0"],
            locale: "it",
            state: {
              seats: { top: null, left: null, right: null, ...Object.fromEntries(Object.entries(seats).map(([dir, seat]) => [dir, { name: seat.name, cards: 0, badge: seat.badge }])) },
              hand: { cards: 0, onTurn: false, faceDown: false },
              pile: 0,
              chips: { combo: [], turn: [] },
            },
          });
          expect(misfits(got, solved, BADGES), `${vp.name}, ${kind}`).toEqual([]);
        }
      }
    } finally {
      await table.close();
    }
  });
});
