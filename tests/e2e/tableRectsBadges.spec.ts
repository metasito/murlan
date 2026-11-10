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

  /**
   * The third human leaving a four-seat table ends the match for the one left (`vacateSeat`: `remaining <= 1`), so
   * three seats are never vacated at once. Every seat reconnecting is compared first, then the last one comes back
   * inside its grace and the two still away are compared once vacated.
   */
  test("every seat's badge, reconnecting then two vacated, on a phone, a bigger phone and a tablet", async ({ browser, baseURL }) => {
    test.setTimeout(360_000);
    const sizes = [SE, SIXTEEN, TABLETS[0]];
    const table = await openOnlineTable(browser, baseURL!, { playerCount: 4, gameMode: "free_for_all", viewport: { width: SE.width, height: SE.height } });
    const solve = (vp: (typeof sizes)[number], seats: Awaited<ReturnType<typeof seated>>) =>
      tableRects({
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
    const compare = async (what: string, badged: readonly string[]) => {
      for (const vp of sizes) {
        await table.page.setViewportSize({ width: vp.width, height: vp.height });
        const { got, seats } = await read(table.page);
        expect(Object.entries(seats).map(([dir, seat]) => `${dir} ${seat.badge?.kind ?? "bare"}`).sort(), `${vp.name}: ${what}`).toEqual([...badged].sort());
        const rect = { top: "badgeTop", left: "badgeLeft", right: "badgeRight" } as const;
        const drawn = Object.entries(seats).filter(([, seat]) => seat.badge).map(([dir]) => rect[dir as keyof typeof rect]);
        for (const name of drawn) expect(got.boxes[name], `${vp.name}, ${what}: ${name} is drawn`).toBeDefined();
        expect(misfits(got, solve(vp, seats), BADGES), `${vp.name}, ${what}`).toEqual([]);
      }
    };
    try {
      for (const gone of table.others) await gone.context().setOffline(true);
      await expect(table.page.getByTestId("notice-reconnecting"), "every seat is reconnecting").toHaveCount(3, { timeout: 90_000 });
      await compare("every seat is reconnecting", ["top reconnecting", "left reconnecting", "right reconnecting"]);

      await table.others[2].context().setOffline(false);
      await expect(table.page.getByTestId("notice-vacated"), "the two still away are vacated").toHaveCount(2, { timeout: 90_000 });
      await expect(table.page.getByTestId("notice-reconnecting"), "the one back is no longer reconnecting").toHaveCount(0);
      const seats = await seated(table.page);
      const bare = Object.entries(seats).filter(([, seat]) => !seat.badge).map(([dir]) => dir);
      expect(bare, "one seat is bare").toHaveLength(1);
      await compare("two seats are vacated", ["top", "left", "right"].map((dir) => `${dir} ${dir === bare[0] ? "bare" : "vacated"}`));
    } finally {
      await table.close();
    }
  });
});
