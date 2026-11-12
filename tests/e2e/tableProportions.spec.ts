// tests/e2e/tableProportions.spec.ts — the table on each phone, at each seat count, is drawn where
// `tableRects` solved it and the solved table keeps its rules; beside that, what the solver's rects
// do not name, measured on the page: the seat count badges and the HUD stack off the cards, a side
// seat above the pile's middle, the turn chip centred over the pile, and no seat name ellipsised.
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { DEAL_SIZE, offlineSave } from "./helpers/offlineSeed";
import { HAND_ZONE } from "./helpers/selectors";
import { PHONES } from "./helpers/phones";
import { check, open } from "./helpers/tableRectsCheck";
import { INSETS } from "../helpers/phoneTable";
import { gameTable } from "../helpers/tableScenes";

/** `toBeCloseTo` precision: 0 admits half a point, which is sub-pixel rounding. */
const SUB_PIXEL = 0;

interface Box { x: number; y: number; w: number; h: number }

async function boxes(page: Page) {
  return page.evaluate((handZone) => {
    const one = (sel: string): Box | null => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { x: b.left, y: b.top, w: b.width, h: b.height };
    };
    const many = (sel: string): Box[] =>
      Array.from(document.querySelectorAll(sel))
        .map((el) => el.getBoundingClientRect())
        .filter((b) => b.width > 0 && b.height > 0)
        .map((b) => ({ x: b.left, y: b.top, w: b.width, h: b.height }));

    return {
      scorePill: one('[data-testid="score-pill"]'),
      turnChip: (() => {
        const b = document.querySelector('[data-testid="turn-chip-dot"]')?.parentElement?.getBoundingClientRect();
        return b ? { x: b.left, y: b.top, w: b.width, h: b.height } : null;
      })(),
      pile: one('[data-testid="pile-area"]'),
      hand: one(handZone),
      sideSeats: [
        one('[data-testid="side-seat-left"]'),
        one('[data-testid="side-seat-right"]'),
      ].filter((b): b is Box => b !== null),
      chrome: [
        ...many('[data-testid="seat-ring"]').map((r) => ({ what: "a seat ring", r })),
        ...many('[data-testid="seat-name"]').map((r) => ({ what: "a seat name", r })),
        ...many('[data-testid="seat-card-count"]').map((r) => ({ what: "a seat badge", r })),
        ...many('[data-testid="game-top-bar"]').map((r) => ({ what: "the top bar", r })),
        ...many('[data-testid="game-hud-stack"]').map((r) => ({ what: "the HUD stack", r })),
        ...many('[data-testid="score-pill"]').map((r) => ({ what: "the score pill", r })),
        ...many('[data-testid="btn-gioca"]').map((r) => ({ what: "GIOCA", r })),
        ...many('[data-testid="btn-passa"]').map((r) => ({ what: "PASSA", r })),
      ],
      clippedNames: Array.from(document.querySelectorAll('[data-testid="seat-name"]'))
        .filter((el) => el.scrollWidth > el.clientWidth + 1)
        .map((el) => el.textContent ?? ""),
    };
  }, HAND_ZONE);
}

for (const phone of PHONES)
  for (const seats of [4, 3, 2] as const)
    test(`the table is drawn in the solver's rects and keeps clear of the cards — ${phone.name}, ${seats} players`, async ({ page, baseURL }) => {
      test.setTimeout(120_000);
      const insets = INSETS["0/0"];
      await page.setViewportSize({ width: phone.width, height: phone.height });
      const save = offlineSave({ seats, hand: DEAL_SIZE[seats] });
      await open(page, baseURL!, save, "it", insets);
      await check(page, `${phone.name}, ${seats} players`, phone, insets, "it", gameTable(save.gameState), undefined, true);

      const b = await boxes(page);
      if (!b.pile || !b.hand) throw new Error("the table never rendered");
      expect(b.sideSeats.length, "the wrong number of side seats rendered").toBe(seats === 4 ? 2 : seats === 3 ? 1 : 0);
      expect(b.clippedNames, `these seat names are ellipsised at their own plate's width: ${b.clippedNames.join(", ")}`).toEqual([]);

      if (seats === 4) {
        if (!b.scorePill) throw new Error("a match's table drew no score pill");
        expect(b.scorePill.x, "the score pill stands right of centre").toBeGreaterThan(phone.width / 2);
        if (!b.turnChip) throw new Error("the table drew no turn chip");
        expect(b.turnChip.x + b.turnChip.w / 2, "the turn chip is centred over the pile").toBeCloseTo(b.pile.x + b.pile.w / 2, SUB_PIXEL);
        expect(b.turnChip.y + b.turnChip.h, "the turn chip sits above the pile").toBeLessThan(b.pile.y);
      }

      // A side seat that spans the pile's own centre line is a ring drawn beside the played cards.
      const pileMiddle = b.pile.y + b.pile.h / 2;
      for (const seat of b.sideSeats)
        expect(Math.round(seat.y + seat.h), `a side seat runs to ${Math.round(seat.y + seat.h)}, past the middle of the pile (${Math.round(pileMiddle)})`).toBeLessThanOrEqual(Math.round(pileMiddle));

      const hits = (target: Box) =>
        b.chrome
          .filter((c) => c.r.x < target.x + target.w && target.x < c.r.x + c.r.w && c.r.y < target.y + target.h && target.y < c.r.y + c.r.h)
          .map((c) => c.what);
      expect(hits(b.pile), `these are drawn over the played cards: ${hits(b.pile).join(", ")}`).toEqual([]);
      expect(hits(b.hand), `these are drawn over the viewer's hand: ${hits(b.hand).join(", ")}`).toEqual([]);
    });
