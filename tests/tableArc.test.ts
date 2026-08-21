// tests/tableArc.test.ts — the one arc solve behind every fan on the table.
//
// The geometry is pure, so it belongs here rather than in a browser: what a
// browser is needed for (tests/e2e/seatFans.spec.ts) is whether the laid-out
// boxes agree with it.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { arcBounds, arcCards, fitSpread } from "../components/tableArc.ts";

const CARD_W = 27;
const CARD_H = 48;

/** A fan's own budget, as components/table/seats.tsx asks for it at scale 1. */
const FAN = { radius: 150, cardW: CARD_W, room: Infinity, step: 9, rise: 16 };

describe("fitSpread", () => {
  test("one card has no spread to solve", () => {
    assert.equal(fitSpread(1, FAN), 0);
    assert.equal(fitSpread(0, FAN), 0);
  });

  test("more cards take more spread, until a budget stops them", () => {
    const two = fitSpread(2, FAN);
    const five = fitSpread(5, FAN);
    assert.ok(five > two);
    assert.ok(two > 0);
  });

  test("the rise budget caps the spread however many cards arrive", () => {
    // Height is what a landscape phone is short of. Past the point where the
    // rise binds, a longer fan flattens rather than climbing.
    const byRise = (2 * Math.acos(1 - FAN.rise / FAN.radius) * 180) / Math.PI;
    assert.ok(Math.abs(fitSpread(30, FAN) - byRise) < 1e-9);
    assert.equal(fitSpread(100, FAN), fitSpread(30, FAN));
    // The floor: below that point it is the ideal step that binds, so a cap
    // asserted on every count would be asserting nothing.
    assert.ok(fitSpread(13, FAN) < byRise);
  });

  test("a width budget binds before the rise one when the room is tight", () => {
    const roomy = fitSpread(6, FAN);
    const cramped = fitSpread(6, { ...FAN, room: CARD_W + 20 });
    assert.ok(cramped < roomy, `${cramped} should be tighter than ${roomy}`);
  });

  test("a width budget below one card's own width still leaves the card drawable", () => {
    // The floor is `cardW + 8`: an arc solved to nothing would stack every
    // card on one point, which is not a hand, it is a bug.
    assert.ok(fitSpread(6, { ...FAN, room: 0 }) > 0);
  });

  test("neither budget can be asked for a spread that is not a number", () => {
    // asin above 1 and acos below -1 are both NaN, and a NaN spread lays every
    // card at the same undefined point — each guard is a clamp, not a comment.
    const huge = FAN.radius * 10;
    // Both clamps at once: a half-turn, which is as open as an arc can be.
    assert.equal(fitSpread(6, { ...FAN, rise: huge, step: huge }), 180);
    // Either one alone leaves the other budget binding, still a real number.
    assert.equal(fitSpread(6, { ...FAN, step: huge }), fitSpread(30, FAN));
    const wideOpen = fitSpread(6, { ...FAN, rise: huge });
    assert.ok(Number.isFinite(wideOpen) && wideOpen > 0 && wideOpen < 180);
  });
});

describe("arcCards", () => {
  const spec = { radius: 150, spread: 42, cardW: CARD_W, cardH: CARD_H };

  test("a single card sits square in the middle, tilted at nothing", () => {
    const { cards } = arcCards(1, spec);
    assert.equal(cards.length, 1);
    assert.equal(cards[0].rot, 0);
    assert.equal(cards[0].x, -CARD_W / 2);
  });

  test("one card and thirteen lay out through the same path, no special case", () => {
    for (const n of [1, 2, 3, 13, 21]) {
      const { cards, box } = arcCards(n, spec);
      assert.equal(cards.length, n);
      assert.ok(box.w >= CARD_W);
      assert.ok(box.h >= CARD_H);
    }
  });

  test("the cards run left to right, tilting away from the middle both ways", () => {
    const { cards } = arcCards(5, spec);
    for (let i = 1; i < cards.length; i++) assert.ok(cards[i].x > cards[i - 1].x);
    assert.ok(cards[0].rot < 0);
    assert.ok(cards[4].rot > 0);
    assert.ok(Math.abs(cards[2].rot) < 1e-9);
  });

  test("flip opens the arc toward its own player — a bowl, not a dome", () => {
    const dome = arcCards(5, spec);
    const bowl = arcCards(5, { ...spec, flip: true });
    // Same horizontal placement; the vertical offsets and the tilts invert.
    for (let i = 0; i < 5; i++) {
      assert.ok(Math.abs(bowl.cards[i].x - dome.cards[i].x) < 1e-9);
      assert.equal(bowl.cards[i].rot, -dome.cards[i].rot);
    }
    // Screen coordinates, so y grows downward: a dome's middle card is its
    // highest, and a bowl's — an arc opened toward its own player — its lowest.
    assert.ok(dome.cards[2].y < dome.cards[0].y);
    assert.ok(bowl.cards[2].y > bowl.cards[0].y);
  });

  test("an empty fan is an empty box, not a NaN one", () => {
    const { cards, box } = arcCards(0, spec);
    assert.deepEqual(cards, []);
    assert.deepEqual(box, { w: 0, h: 0 });
  });
});

describe("arcBounds", () => {
  const spec = { radius: 150, spread: 42, cardW: CARD_W, cardH: CARD_H, flip: true };

  test("the bounds hold every card's own rotated corners", () => {
    const { cards, box } = arcCards(7, spec);
    const bounds = arcBounds(cards, box, CARD_W, CARD_H);
    for (const card of cards) {
      const rad = (card.rot * Math.PI) / 180;
      const hx = (CARD_W * Math.abs(Math.cos(rad)) + CARD_H * Math.abs(Math.sin(rad))) / 2;
      const hy = (CARD_W * Math.abs(Math.sin(rad)) + CARD_H * Math.abs(Math.cos(rad))) / 2;
      const px = box.w / 2 + card.x + CARD_W / 2;
      const py = card.y + CARD_H / 2;
      assert.ok(px - hx >= bounds.cx - bounds.w / 2 - 1e-9);
      assert.ok(px + hx <= bounds.cx + bounds.w / 2 + 1e-9);
      assert.ok(py - hy >= bounds.cy - bounds.h / 2 - 1e-9);
      assert.ok(py + hy <= bounds.cy + bounds.h / 2 + 1e-9);
    }
  });

  test("the arc really does overflow its own box, which is why this exists", () => {
    // The floor: if the cards fitted their box, rotating about the box would
    // be the same thing and nothing here would be worth computing.
    const { cards, box } = arcCards(9, spec);
    const bounds = arcBounds(cards, box, CARD_W, CARD_H);
    assert.ok(
      bounds.w > box.w || bounds.h > box.h,
      `bounds ${bounds.w}x${bounds.h} fit inside the box ${box.w}x${box.h}`
    );
  });

  test("a symmetric arc is centred on its own box, horizontally", () => {
    const { cards, box } = arcCards(7, spec);
    const bounds = arcBounds(cards, box, CARD_W, CARD_H);
    assert.ok(Math.abs(bounds.cx - box.w / 2) < 1e-9);
  });

  test("the same input gives the same bounds however often it is asked", () => {
    // Derived from the arc, never measured: a measurement reads back the
    // rotation the current pass is about to replace, so the fan creeps.
    const first = arcBounds(...boundsArgs());
    for (let i = 0; i < 5; i++) assert.deepEqual(arcBounds(...boundsArgs()), first);
  });

  function boundsArgs() {
    const { cards, box } = arcCards(11, spec);
    return [cards, box, CARD_W, CARD_H] as const;
  }
});
