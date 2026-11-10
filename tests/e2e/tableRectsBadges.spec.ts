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

  /** The seats and the rects, read until the same badges, with the same digit counts, stood before and after the rects were. */
  async function read(page: Page) {
    for (let tries = 0; tries < 10; tries++) {
      const before = await seated(page);
      const got = await settled(page, BADGES);
      const after = await seated(page);
      const shape = (seats: typeof before) => JSON.stringify(Object.entries(seats).map(([dir, seat]) => [dir, seat.name, seat.badge?.kind, seat.badge && "seconds" in seat.badge ? String(seat.badge.seconds).length : 0]));
      if (shape(before) === shape(after)) return { got, seats: after };
    }
    throw new Error("the badges kept changing shape under the read");
  }

  test("every seat's badge, reconnecting then vacated, on a phone, a bigger phone and a tablet", async ({ browser, baseURL }) => {
    test.setTimeout(360_000);
    const sizes = [SE, SIXTEEN, TABLETS[0]];
    const table = await openOnlineTable(browser, baseURL!, { playerCount: 4, gameMode: "free_for_all", viewport: { width: SE.width, height: SE.height } });
    try {
      for (const gone of table.others) await gone.context().setOffline(true);
      for (const kind of ["reconnecting", "vacated"] as const) {
        if (kind === "reconnecting") await expect(table.page.getByTestId("notice-reconnecting"), "every seat is reconnecting").toHaveCount(3, { timeout: 90_000 });
        else await expect(table.page.getByTestId("notice-vacated"), "a seat is vacated").not.toHaveCount(0, { timeout: 90_000 });
        for (const vp of sizes) {
          await table.page.setViewportSize({ width: vp.width, height: vp.height });
          const { got, seats } = await read(table.page);
          expect(Object.entries(seats).map(([dir, seat]) => `${dir} ${seat.badge ? "badged" : "bare"}`).sort(), `${vp.name}: every seat wears a badge`).toEqual(["left badged", "right badged", "top badged"]);
          if (kind === "vacated") expect(Object.values(seats).some((seat) => seat.badge?.kind === "vacated"), `${vp.name}: a seat is vacated`).toBe(true);
          else expect(Object.values(seats).every((seat) => seat.badge?.kind === "reconnecting"), `${vp.name}: every seat is reconnecting`).toBe(true);
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
          for (const name of ["badgeTop", "badgeLeft", "badgeRight"] as const) expect(got.boxes[name], `${vp.name}, ${kind}: ${name} is drawn`).toBeDefined();
          expect(misfits(got, solved, BADGES), `${vp.name}, ${kind}`).toEqual([]);
        }
      }
    } finally {
      await table.close();
    }
  });
});
