// tests/cardFace.test.ts — the card face is the thing a card game is looked at
// through, and its geometry is all magic fractions. Two properties are easy to
// break and only noticeable by eye: pips must not touch the corner index, and
// a rank must draw exactly as many pips as its number. Both are pinned
// numerically here.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  CARD_W,
  CARD_H,
  CARD_W_SMALL,
  CARD_H_SMALL,
  PIP_LAYOUTS,
  PIP_RANKS,
  COURT_RANKS,
  placedPips,
  pipBox,
  indexBox,
  boxesOverlap,
  rankTextWidth,
  INDEX_TEXT_W,
  isWideRank,
} from "../components/cardFaceModel.ts";

// The index (rank glyphs + suit mark) is drawn at both sizes. The pip field is
// not: a small card is too narrow for one and draws a single centred mark
// instead, so pip geometry is only checked at the size that renders it.
const SIZES = [
  { name: "normal", w: CARD_W, h: CARD_H, small: false },
  { name: "small", w: CARD_W_SMALL, h: CARD_H_SMALL, small: true },
];
const PIP_SIZES = SIZES.filter((s) => !s.small);

describe("pip counts", () => {
  test("every pip rank draws exactly as many pips as its rank", () => {
    for (const rank of PIP_RANKS) {
      const expected = Number(rank);
      assert.equal(
        PIP_LAYOUTS[rank].length,
        expected,
        `rank ${rank} lays out ${PIP_LAYOUTS[rank].length} pips`
      );
      assert.equal(placedPips(rank, CARD_W, CARD_H).length, expected);
    }
  });

  test("the pip ranks are exactly 2-10 — aces and courts are drawn another way", () => {
    assert.deepEqual(PIP_RANKS.sort(), ["10", "2", "3", "4", "5", "6", "7", "8", "9"].sort());
    for (const court of COURT_RANKS) {
      assert.ok(!(court in PIP_LAYOUTS), `${court} must not draw a pip field`);
    }
    assert.ok(!("A" in PIP_LAYOUTS), "the ace draws one large centred pip");
  });
});

describe("nothing collides with the corner index", () => {
  for (const { name, w, h, small } of PIP_SIZES) {
    test(`no pip overlaps the index column on a ${name} card`, () => {
      const offenders: string[] = [];
      for (const rank of PIP_RANKS) {
        const index = indexBox(rank, w, h, small);
        for (const [i, pip] of placedPips(rank, w, h).entries()) {
          if (boxesOverlap(pipBox(pip), index)) {
            offenders.push(
              `${rank}: pip ${i} at x=${pip.x.toFixed(1)} overlaps index right edge ${index.right.toFixed(1)}`
            );
          }
        }
      }
      assert.deepEqual(offenders, [], offenders.join("\n"));
    });
  }

  // The index is drawn at both sizes, so its glyphs must fit at both.
  for (const { name, w, small } of SIZES) {
    test(`the rank glyphs fit inside the index box on a ${name} card`, () => {
      // "10" is the only two-glyph rank and needs its own size; at the
      // single-glyph size it is wider than the box and reaches the pip field.
      const box = w * INDEX_TEXT_W;
      for (const rank of [...PIP_RANKS, "A", "J", "Q", "K"]) {
        const width = rankTextWidth(rank, small);
        assert.ok(
          width <= box,
          `${rank} renders ${width.toFixed(2)}px wide in a ${box.toFixed(2)}px index box`
        );
      }
    });
  }

  test("only 10 is treated as a wide rank", () => {
    assert.ok(isWideRank("10"));
    for (const rank of ["2", "9", "A", "J", "Q", "K", "JK"]) {
      assert.ok(!isWideRank(rank), `${rank} should not be widened`);
    }
  });
});

describe("pips do not collide with each other", () => {
  for (const { name, w, h } of PIP_SIZES) {
    test(`no two pips overlap on a ${name} card`, () => {
      const offenders: string[] = [];
      for (const rank of PIP_RANKS) {
        const pips = placedPips(rank, w, h).map(pipBox);
        for (let i = 0; i < pips.length; i++) {
          for (let j = i + 1; j < pips.length; j++) {
            if (boxesOverlap(pips[i], pips[j])) offenders.push(`${rank}: pips ${i} and ${j}`);
          }
        }
      }
      assert.deepEqual(offenders, [], offenders.join("\n"));
    });
  }
});

describe("the pip field stays inside the card", () => {
  for (const { name, w, h } of PIP_SIZES) {
    test(`every pip is within the ${name} card's bounds`, () => {
      for (const rank of PIP_RANKS) {
        for (const pip of placedPips(rank, w, h)) {
          const box = pipBox(pip);
          assert.ok(box.left >= 0 && box.right <= w, `${rank}: pip escapes horizontally`);
          assert.ok(box.top >= 0 && box.bottom <= h, `${rank}: pip escapes vertically`);
        }
      }
    });
  }
});
