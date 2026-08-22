// tests/e2e/seatFans.spec.ts — three seats, one construction, turned a quarter.
//
// Each opponent's fan sits between them and the table with its arc opening
// toward its own player, and the whole thing is rotated about what the cards
// actually occupy rather than about the box that holds them — the arc
// deliberately overflows its box. None of that is visible to a unit test:
// react-test-renderer never runs flexbox, so which side of a seat a fan lands
// on is only knowable from a laid-out box.
//
// The creep is the reason for the repeat: reading the fan's centre back with a
// measurement returns the rotation the current pass is about to replace, so a
// fan built that way drifts a little on every relayout. Measuring twice, with
// a relayout in between, is what catches it.
import { test, expect, type Page } from "@playwright/test";
import { openSeededGame } from "./helpers/offlineSeed";

const VIEWPORT = { width: 844, height: 390 };

interface SeatGeometry {
  side: string;
  /** Centre of the avatar's turn ring. */
  ring: { x: number; y: number };
  /** Centre of what the fan's cards actually occupy. */
  fan: { x: number; y: number };
  /** Nearest edge-to-edge distance from the ring to the fan. */
  gap: number;
}

/**
 * Every opponent seat's ring and fan, measured from the cards themselves. The
 * fan's own box is not the answer: the arc overflows it, so the cards' union
 * rect is what a player actually sees.
 */
async function seatGeometry(page: Page): Promise<SeatGeometry[]> {
  return page.evaluate(() => {
    const out: SeatGeometry[] = [];
    for (const side of ["top", "left", "right"]) {
      const seat = document.querySelector(
        side === "top" ? '[data-testid="top-seat"]' : `[data-testid="side-seat-${side}"]`
      );
      if (!seat) continue;

      // A back is an <svg>-bearing card with no accessible name — the ring is
      // the only text-bearing disc in a seat, so the two never collide.
      const backs = [...seat.querySelectorAll("svg")]
        .map((el) => el.parentElement?.getBoundingClientRect())
        .filter((r): r is DOMRect => !!r && r.width > 0 && r.height > 0);
      if (backs.length === 0) continue;

      const union = {
        left: Math.min(...backs.map((r) => r.left)),
        right: Math.max(...backs.map((r) => r.right)),
        top: Math.min(...backs.map((r) => r.top)),
        bottom: Math.max(...backs.map((r) => r.bottom)),
      };

      // Asked for by name. Found by shape, the seat's own bot and passed
      // markers answer first — they are chips, and a chip is round too.
      const ring = seat.querySelector('[data-testid="seat-ring"]');
      if (!ring) throw new Error(`the ${side} seat has no ring`);
      const ringRect = ring.getBoundingClientRect();

      out.push({
        side,
        ring: { x: ringRect.left + ringRect.width / 2, y: ringRect.top + ringRect.height / 2 },
        fan: { x: (union.left + union.right) / 2, y: (union.top + union.bottom) / 2 },
        gap:
          side === "top"
            ? union.top - ringRect.bottom
            : side === "left"
              ? union.left - ringRect.right
              : ringRect.left - union.right,
      });
    }
    return out;
  });
}

test.describe("the opponents' fans", () => {
  test("centre on their own ring, keep one gap, and do not creep", async ({ page, baseURL }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(VIEWPORT);
    await openSeededGame(page, baseURL!, 4);
    await page.waitForTimeout(1_500);

    const first = await seatGeometry(page);
    expect(
      first.map((s) => s.side).sort(),
      "four seats did not produce a top, a left and a right opponent"
    ).toEqual(["left", "right", "top"]);

    for (const seat of first) {
      // A side seat's fan is turned a quarter, so it lines up with its ring on
      // the *other* axis; the top seat's lines up horizontally.
      const axis = seat.side === "top" ? "x" : "y";
      expect(
        Math.abs(seat.ring[axis] - seat.fan[axis]),
        `the ${seat.side} seat's ring (${axis} ${Math.round(seat.ring[axis])}) and its fan ` +
          `(${Math.round(seat.fan[axis])}) are not on the same line`
      ).toBeLessThanOrEqual(2);
    }

    // One gap for all three: the name floats above the avatar out of flow, so
    // the seat carrying a bot badge cannot push its own fan further away.
    const gaps = first.map((s) => s.gap);
    expect(
      Math.max(...gaps) - Math.min(...gaps),
      `the ring-to-fan gap differs by seat: ` +
        first.map((s) => `${s.side} ${s.gap.toFixed(1)}`).join(", ")
    ).toBeLessThanOrEqual(2);

    // Relayout, twice, then come back. A fan that reads its own rotation back
    // from a measurement drifts a few pixels every pass — ~50px over a session.
    for (const size of [{ width: 900, height: 420 }, VIEWPORT, { width: 700, height: 380 }, VIEWPORT]) {
      await page.setViewportSize(size);
      await page.waitForTimeout(400);
    }
    const again = await seatGeometry(page);
    for (let i = 0; i < first.length; i++) {
      expect(
        Math.abs(again[i].fan.x - first[i].fan.x) + Math.abs(again[i].fan.y - first[i].fan.y),
        `the ${first[i].side} seat's fan crept across relayouts: ` +
          `(${first[i].fan.x.toFixed(1)}, ${first[i].fan.y.toFixed(1)}) → ` +
          `(${again[i].fan.x.toFixed(1)}, ${again[i].fan.y.toFixed(1)})`
      ).toBeLessThanOrEqual(1);
    }
  });
});
