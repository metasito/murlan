// tests/suitColours.test.ts — can the suits be told apart, including by a
// player with colour-vision deficiency?
//
// The backlog carried "colourblind-safe suit differentiation" as an
// improvement to make. Measured, the traditional two-colour deck already
// passes, and the obvious "fix" — a four-colour deck with a green club — is a
// regression: red and green are the pair deuteranopes cannot separate. Both
// facts are pinned here so the change is not made on intuition later.
//
// Simulation is Viénot, Brettel & Mollon (1999), the standard dichromat model,
// applied in linear RGB. Distance is CIE76 ΔE in Lab: crude next to CIEDE2000,
// but these colours are far apart or not at all, and the margins below are wide
// enough that the difference between the two metrics cannot change an answer.
// @ts-ignore
import { Colors } from "../lib/tokens.ts";
import { test, describe } from "node:test";
import assert from "node:assert/strict";

type RGB = [number, number, number];
type Lab = [number, number, number];

const srgbToLinear = (c: number) =>
  c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;

function hexToLinear(hex: string): RGB {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => srgbToLinear(parseInt(h.slice(i, i + 2), 16) / 255)) as RGB;
}

const VISION: Record<string, number[][]> = {
  normal: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  protanopia: [
    [0.11238, 0.88762, 0.0],
    [0.11238, 0.88762, 0.0],
    [0.004, -0.004, 1.0],
  ],
  deuteranopia: [
    [0.29275, 0.70725, 0.0],
    [0.29275, 0.70725, 0.0],
    [-0.02234, 0.02234, 1.0],
  ],
  tritanopia: [
    [1.0, 0.1442, -0.1442],
    [0.0, 0.85831, 0.14169],
    [0.0, 0.85831, 0.14169],
  ],
};

const applyMatrix = (m: number[][], v: RGB): RGB =>
  m.map((row) => row.reduce((sum, k, i) => sum + k * v[i], 0)) as RGB;

function linearToLab([r, g, b]: RGB): Lab {
  const X = 0.4124 * r + 0.3576 * g + 0.1805 * b;
  const Y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const Z = 0.0193 * r + 0.1192 * g + 0.9505 * b;
  const white = [0.95047, 1.0, 1.08883];
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const [fx, fy, fz] = [X / white[0], Y / white[1], Z / white[2]].map(f);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

const deltaE = (a: Lab, b: Lab) =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** ΔE between two hex colours as seen with the given vision type. */
function separation(hexA: string, hexB: string, vision: string): number {
  const m = VISION[vision];
  return deltaE(
    linearToLab(applyMatrix(m, hexToLinear(hexA))),
    linearToLab(applyMatrix(m, hexToLinear(hexB)))
  );
}

// Comfortably above "noticeably different" (ΔE ~2.3) — these are small marks on
// a card seen at a glance, not swatches compared side by side.
const MIN_SEPARATION = 25;

describe("suit ink is distinguishable, including under colour-vision deficiency", () => {
  test("the deck uses exactly two inks, as a traditional deck does", () => {
    assert.equal(Colors.heart, Colors.diamond, "the red suits share one ink");
    assert.equal(Colors.spade, Colors.club, "the black suits share one ink");
    // Which is why colour is not the only channel: the pip glyph differs per
    // suit, and the index carries the same glyph.
    assert.notEqual(Colors.heart, Colors.spade);
  });

  for (const vision of Object.keys(VISION)) {
    test(`red and black inks stay apart under ${vision}`, () => {
      const d = separation(Colors.heart, Colors.spade, vision);
      assert.ok(
        d >= MIN_SEPARATION,
        `heart vs spade is ΔE ${d.toFixed(1)} under ${vision}, want >= ${MIN_SEPARATION}`
      );
    });
  }

  test("a four-colour deck with a green club would be a regression, not a fix", () => {
    // Recorded rather than argued: the standard four-colour deck (red hearts,
    // blue diamonds, green clubs, black spades) puts red against green, which
    // is precisely the pair a deuteranope cannot separate.
    const fourColour = {
      spade: "#1A1A1A",
      heart: "#C8102E",
      diamond: "#1565C0",
      club: "#2E7D32",
    };
    const names = Object.keys(fourColour) as (keyof typeof fourColour)[];
    let worst = Infinity;
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        worst = Math.min(
          worst,
          separation(fourColour[names[i]], fourColour[names[j]], "deuteranopia")
        );
      }
    }
    assert.ok(
      worst < MIN_SEPARATION,
      `expected the four-colour deck to fail under deuteranopia, got ΔE ${worst.toFixed(1)}`
    );
    // And the current deck, measured the same way, does not.
    assert.ok(
      separation(Colors.heart, Colors.spade, "deuteranopia") >= MIN_SEPARATION
    );
  });

  test("both inks stay legible on the card face itself", () => {
    // A suit mark is a filled glyph on printed-stock white, not text, so this
    // is a visibility floor rather than a WCAG text ratio.
    for (const ink of [Colors.heart, Colors.spade]) {
      for (const paper of [Colors.cardPaper, Colors.cardPaperEdge]) {
        const d = separation(ink, paper, "normal");
        assert.ok(d >= 40, `${ink} on ${paper} is only ΔE ${d.toFixed(1)}`);
      }
    }
  });
});
