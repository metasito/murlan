// tests/e2e/tableProportions.spec.ts — the table's element sizes, measured on
// a laid-out phone rather than asserted against the constants that produced
// them.
//
// Every number here is `<authored> * cardScale(shortEdge)`, and the model's own
// unit tests pin the authored values. What they cannot see is whether the
// element that reaches the screen is that size, and where it ends up: seat
// placement is flexbox in a row whose cross axis is up-and-down, which
// react-test-renderer never runs (CLAUDE.md, *Known pitfalls*). #340.
import { test, expect, type Page } from "@playwright/test";
import { openSeededGame } from "./helpers/offlineSeed";
import { CHIP_H, SEAT_DISC, actionBtnSize } from "../../components/gameTableModel";
import { cardScale } from "../../components/cardFaceModel";

// tests/e2e/handParity.spec.ts's own handsets.
const PHONES = [
  { name: "iPhone SE", width: 568, height: 320 },
  { name: "iPhone 12", width: 844, height: 390 },
  { name: "iPhone 16 Pro", width: 874, height: 402 },
  { name: "iPhone 17 Pro Max", width: 956, height: 440 },
];

/** Sub-pixel: a box laid out at 57.72 reports 57.7. */
const TOLERANCE = 1;

interface Box { x: number; y: number; w: number; h: number }

async function boxes(page: Page) {
  return page.evaluate(() => {
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
      gioca: one('[data-testid="btn-gioca"]'),
      passa: one('[data-testid="btn-passa"]'),
      topBar: one('[data-testid="game-top-bar"]'),
      rings: many('[data-testid="seat-ring"]'),
      pile: one('[data-testid="pile-area"]'),
      hand: one('[aria-label^="La tua mano"]'),
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
        ...many('[data-testid="btn-gioca"]').map((r) => ({ what: "GIOCA", r })),
        ...many('[data-testid="btn-passa"]').map((r) => ({ what: "PASSA", r })),
      ],
    };
  });
}

for (const phone of PHONES) {
  test(`the table's elements are sized from the short edge — ${phone.name}`, async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: phone.width, height: phone.height });
    await openSeededGame(page, baseURL!, 4);
    await page.waitForTimeout(2_500);

    const s = cardScale(Math.min(phone.width, phone.height));
    const b = await boxes(page);
    if (!b.gioca || !b.passa || !b.topBar) throw new Error("the table never rendered");

    // The floor: an element that laid out as an empty box would satisfy no
    // equality below, but say so clearly if it happens.
    expect(b.rings.length, "no seat ring rendered at all").toBeGreaterThan(0);

    for (const [what, box] of [["GIOCA", b.gioca], ["PASSA", b.passa]] as const) {
      expect(box.w, `${what} is ${box.w.toFixed(1)} wide, not ${actionBtnSize(s).toFixed(1)}`)
        .toBeCloseTo(actionBtnSize(s), -Math.log10(TOLERANCE));
      expect(box.h, `${what} is ${box.h.toFixed(1)} tall, not square`).toBeCloseTo(box.w, -Math.log10(TOLERANCE));
    }

    expect(
      b.topBar.h,
      `the HUD chip is ${b.topBar.h.toFixed(1)} tall, not ${CHIP_H(s).toFixed(1)}`
    ).toBeCloseTo(CHIP_H(s), -Math.log10(TOLERANCE));

    for (const ring of b.rings) {
      expect(
        ring.w,
        `a seat ring is ${ring.w.toFixed(1)} across, not ${(SEAT_DISC * s).toFixed(1)}`
      ).toBeCloseTo(SEAT_DISC * s, -Math.log10(TOLERANCE));
    }
  });

  test(`the seats keep clear of the cards — ${phone.name}`, async ({ page, baseURL }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: phone.width, height: phone.height });
    await openSeededGame(page, baseURL!, 4);
    await page.waitForTimeout(2_500);

    const b = await boxes(page);
    if (!b.pile || !b.hand) throw new Error("the table never rendered");
    expect(b.sideSeats.length, "neither side seat rendered").toBe(2);

    // High in the mid band, not level with the cards: a side seat that spans
    // the pile's own centre line is a ring drawn beside the played cards.
    const pileMiddle = b.pile.y + b.pile.h / 2;
    for (const seat of b.sideSeats) {
      expect(
        Math.round(seat.y + seat.h),
        `a side seat runs to ${Math.round(seat.y + seat.h)}, past the middle of the pile ` +
          `(${Math.round(pileMiddle)}) — it stands beside the cards instead of above them`
      ).toBeLessThanOrEqual(Math.round(pileMiddle));
    }

    const hits = (target: Box) =>
      b.chrome
        .filter(
          (c) =>
            c.r.x < target.x + target.w &&
            target.x < c.r.x + c.r.w &&
            c.r.y < target.y + target.h &&
            target.y < c.r.y + c.r.h
        )
        .map((c) => c.what);

    expect(hits(b.pile), `these are drawn over the played cards: ${hits(b.pile).join(", ")}`).toEqual([]);
    expect(hits(b.hand), `these are drawn over the viewer's hand: ${hits(b.hand).join(", ")}`).toEqual([]);
  });
}
