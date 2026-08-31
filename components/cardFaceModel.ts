// Pure geometry of a card face, kept out of CardView.tsx for the same reason
// gameTableModel.ts is kept out of GameTable.tsx: Node's test loader strips
// plain .ts but cannot parse .tsx, so none of this is reachable from a test
// while it lives next to JSX.
//
// Everything is expressed as a fraction of the card's own width or height, so
// one set of numbers serves both card sizes.

import type { Rank } from "@/lib/gameEngine";
import { TOUCH_TARGET_MIN } from "../lib/tokens.ts";

// ─── Scale ──────────────────────────────────────────────────────────────────
//
// One scale factor for every card and touch target on the table, derived from
// the device's short edge — no breakpoints, no tablet branch. 390 is the
// short edge the base sizes below are authored at (an iPhone-standard
// viewport); an SE runs ~0.82, a 17 Pro Max ~1.13.
export const BASE_SHORT_EDGE = 390;
// Caps scale on a maximized desktop browser, where the short edge keeps
// growing with the window — a real device's short edge tops out well below
// this (tableFit.spec.ts's own tablet-landscape fixture is 834).
const MAX_SHORT_EDGE = 900;

export function cardScale(shortEdge: number): number {
  return Math.min(shortEdge, MAX_SHORT_EDGE) / BASE_SHORT_EDGE;
}

// A card face (lying on the felt or standing in a hand) at scale 1.
const FACE_W = 64;
const FACE_H = 90;
// A card back (an opponent's hand) at scale 1 — its own aspect, not the face
// scaled down: a card standing in a hand is not a card lying on cloth.
const BACK_W = 27;
const BACK_H = 48;

export const CARD_W = (s: number) => FACE_W * s;
export const CARD_H = (s: number) => FACE_H * s;
export const CARD_BACK_W = (s: number) => BACK_W * s;
export const CARD_BACK_H = (s: number) => BACK_H * s;

/** Multipliers on the table's own scale, by where the card is drawn. */
export const FIELD_SCALE = 1.0;
export const HAND_SCALE = 1.08;
/** …and while the turn is the viewer's own, when the hand is held up to be read. */
export const HAND_SCALE_ON_TURN = 1.2;
/** What the hand's width share is multiplied by at that size, so the fan opens with it. */
export const HAND_NEAR_RATIO = HAND_SCALE_ON_TURN / HAND_SCALE;
export const BACK_SCALE = 0.88;

// ─── Card stock ─────────────────────────────────────────────────────────────
//
// A card is a physical object, not a flat swatch: a corner cut, a printed
// border just inside the edge, and a lit lip where the stock meets the felt.
// Values below are authored at 2x table scale, like the rest of the card, and
// halved here to land at scale 1.

// Real poker stock has a 1/8in radius on a 2.5in card — 5% of card width. A
// fixed step of `Radius` (lib/tokens.ts) can't express that, since it has to
// scale with the card rather than sit on the app's five-step scale.
const CARD_RADIUS_RATIO = 0.05;
export function cardRadius(w: number): number {
  return w * CARD_RADIUS_RATIO;
}

const STOCK_LIP_RATIO = 1 / FACE_H;

/** Height of the lit lip along the stock's bottom edge. */
export function stockLipHeight(h: number): number {
  return h * STOCK_LIP_RATIO;
}

// ─── Card back stock ────────────────────────────────────────────────────────
//
// The back's own corner radius is `cardRadius` above, fed the back's own
// width — CARD_BACK_W/H is a different aspect ratio than the face, so the
// ratio has to derive from that width rather than reuse the face's radius.

/**
 * The card back's 45 degree lattice, as one SVG path. A fine line reads as
 * texture at any size where a dot grid reads as blobs, because a line keeps
 * its identity when it falls below a pixel and a dot does not.
 */
const latticeCache = new Map<string, string>();
export function getLattice(w: number, h: number, spacing: number): string {
  const key = `${w}x${h}x${spacing}`;
  let d = latticeCache.get(key);
  if (!d) {
    const span = w + h;
    const parts: string[] = [];
    for (let i = -h; i < span; i += spacing) {
      parts.push(`M${i},0 L${i + h},${h}`);
      parts.push(`M${i},${h} L${i + h},0`);
    }
    d = parts.join(" ");
    latticeCache.set(key, d);
  }
  return d;
}

/**
 * A touch target's floor is physical size — never `TOUCH_TARGET_MIN * s`.
 * The control rail's knobs are sized by it (`knobSize`, components/
 * GameTable.tsx), pinned by tests/touchTargets.test.ts.
 */
export function physicalTouchTarget(s: number): number {
  return Math.max(TOUCH_TARGET_MIN, TOUCH_TARGET_MIN * s);
}

// ─── Index column ─────────────────────────────────────────────────────────────
//
// The rank character sits at the top-left with the suit mark below it, and the
// pair is repeated rotated at the bottom-right.

export const INDEX_X = 0.118;      // centre of the index column
export const INDEX_SUIT_Y = 0.25;  // suit mark, below the rank character
export const INDEX_SUIT_SIZE = 0.10;

/** Index text box width, as a fraction of card width. Centred on INDEX_X. */
export const INDEX_TEXT_W = INDEX_X * 2;

// Rajdhani Bold advances roughly 0.55em per digit. "10" is the only two-glyph
// rank, and at the single-glyph size it renders wider than the index box and
// spills into the pip field. It gets its own, narrower ratio so it fits
// instead. Both ratios are of card height, continuous rather than a fixed
// pair of sizes — there is no longer a discrete "small card" to pin them to.
const RANK_FONT_RATIO = 15 / FACE_H;
const RANK_FONT_WIDE_RATIO = 12 / FACE_H;
// Clearance between the card edge and the rank glyph's own line box. Rajdhani
// draws ink beyond that line box (ascender/descender overshoot), and that
// overshoot grows with font size — so at a fixed pixel inset, a large enough
// card scales the glyph past a clearance sized for the base card, and the tip
// clips against the card's own `overflow: hidden` (tests/e2e/a11yOverlays.spec.ts
// "no rank glyph clips"). A fraction of card height keeps the two in step.
const RANK_INSET_RATIO = 4.5 / FACE_H;
const GLYPH_ADVANCE_EM = 0.55;
const LETTER_SPACING = -0.5;

export function isWideRank(rank: string): boolean {
  return rank.length > 1 && rank !== "JK";
}

export function rankFontSize(rank: string, h: number): number {
  return h * (isWideRank(rank) ? RANK_FONT_WIDE_RATIO : RANK_FONT_RATIO);
}

export function rankInset(h: number): number {
  return h * RANK_INSET_RATIO;
}

/** Rendered width of a rank's glyphs at the size it is drawn. */
export function rankTextWidth(rank: string, h: number): number {
  const size = rankFontSize(rank, h);
  const glyphs = rank.length;
  return glyphs * GLYPH_ADVANCE_EM * size + (glyphs - 1) * LETTER_SPACING;
}

export interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Pixel box the top-left index occupies — rank glyphs and suit mark together. */
export function indexBox(rank: string, w: number, h: number): Box {
  const centreX = w * INDEX_X;
  const textHalf = rankTextWidth(rank, h) / 2;
  const suitHalf = (h * INDEX_SUIT_SIZE) / 2;
  const half = Math.max(textHalf, suitHalf);
  return {
    left: centreX - half,
    right: centreX + half,
    top: 0,
    bottom: h * INDEX_SUIT_Y + suitHalf,
  };
}

// ─── Pip field ────────────────────────────────────────────────────────────────
//
// Three columns to the right of the index column. The left column must clear
// the index entirely: a pip drawn over the rank character is the defect this
// geometry exists to prevent.

export const PIP_COL = { left: 0.33, centre: 0.5, right: 0.67 } as const;
export const PIP_TOP = 0.16;
export const PIP_BOTTOM = 0.84;
export const PIP_SIZE = 0.145;    // of card height
export const ACE_PIP_SIZE = 0.30;
/** Ranks with more than six pips draw them slightly smaller to stay uncrowded. */
export const CROWDED_PIP_SCALE = 0.70;
const CROWDED_ABOVE = 6;

export type PipColumn = keyof typeof PIP_COL;
export interface PipSpot {
  col: PipColumn;
  /** 0 = top row of the pip field, 1 = bottom row. */
  row: number;
}

// The traditional pip grids. Anything below the halfway line prints upside
// down, exactly as it does on a real card, so the card reads the same from
// either end.
const THIRD = 1 / 3;
export const PIP_LAYOUTS: Record<string, PipSpot[]> = {
  "2": [{ col: "centre", row: 0 }, { col: "centre", row: 1 }],
  "3": [{ col: "centre", row: 0 }, { col: "centre", row: 0.5 }, { col: "centre", row: 1 }],
  "4": [
    { col: "left", row: 0 }, { col: "right", row: 0 },
    { col: "left", row: 1 }, { col: "right", row: 1 },
  ],
  "5": [
    { col: "left", row: 0 }, { col: "right", row: 0 },
    { col: "centre", row: 0.5 },
    { col: "left", row: 1 }, { col: "right", row: 1 },
  ],
  "6": [
    { col: "left", row: 0 }, { col: "right", row: 0 },
    { col: "left", row: 0.5 }, { col: "right", row: 0.5 },
    { col: "left", row: 1 }, { col: "right", row: 1 },
  ],
  "7": [
    { col: "left", row: 0 }, { col: "right", row: 0 },
    { col: "centre", row: 0.25 },
    { col: "left", row: 0.5 }, { col: "right", row: 0.5 },
    { col: "left", row: 1 }, { col: "right", row: 1 },
  ],
  "8": [
    { col: "left", row: 0 }, { col: "right", row: 0 },
    { col: "centre", row: 0.25 },
    { col: "left", row: 0.5 }, { col: "right", row: 0.5 },
    { col: "centre", row: 0.75 },
    { col: "left", row: 1 }, { col: "right", row: 1 },
  ],
  "9": [
    { col: "left", row: 0 }, { col: "right", row: 0 },
    { col: "left", row: THIRD }, { col: "right", row: THIRD },
    { col: "centre", row: 0.5 },
    { col: "left", row: 2 * THIRD }, { col: "right", row: 2 * THIRD },
    { col: "left", row: 1 }, { col: "right", row: 1 },
  ],
  "10": [
    { col: "left", row: 0 }, { col: "right", row: 0 },
    { col: "centre", row: 1 / 6 },
    { col: "left", row: THIRD }, { col: "right", row: THIRD },
    { col: "left", row: 2 * THIRD }, { col: "right", row: 2 * THIRD },
    { col: "centre", row: 5 / 6 },
    { col: "left", row: 1 }, { col: "right", row: 1 },
  ],
};

export const COURT_RANKS = new Set(["J", "Q", "K"]);

/**
 * Where the court figure sits, as fractions of the card. These are the crop box
 * the art was cut from its source card with — and because the source deck and
 * this card have the same aspect (0.688 vs 0.690), placing it at the same
 * fractions reproduces a real card's proportions rather than approximating them.
 * `scripts/build-court-art.mjs` regenerates the art against these numbers.
 */
export const COURT_ART_BOX = { x0: 0.305, x1: 0.695, y0: 0.105, y1: 0.895 } as const;

export function courtArtRect(w: number, h: number) {
  return {
    left: w * COURT_ART_BOX.x0,
    top: h * COURT_ART_BOX.y0,
    width: w * (COURT_ART_BOX.x1 - COURT_ART_BOX.x0),
    height: h * (COURT_ART_BOX.y1 - COURT_ART_BOX.y0),
  };
}

/** Ranks drawn as a pip field. Aces and courts are drawn differently. */
export const PIP_RANKS = Object.keys(PIP_LAYOUTS);

export interface PlacedPip {
  x: number;
  y: number;
  size: number;
  flipped: boolean;
}

/** Where every pip of a rank lands, in pixels, for a card of this size. */
export function placedPips(rank: Rank | string, w: number, h: number): PlacedPip[] {
  const spots = PIP_LAYOUTS[rank] ?? [];
  const size = h * PIP_SIZE * (spots.length > CROWDED_ABOVE ? CROWDED_PIP_SCALE : 1);
  return spots.map((spot) => ({
    x: w * PIP_COL[spot.col],
    y: h * (PIP_TOP + spot.row * (PIP_BOTTOM - PIP_TOP)),
    size,
    flipped: spot.row > 0.5,
  }));
}

export function pipBox(pip: PlacedPip): Box {
  const half = pip.size / 2;
  return { left: pip.x - half, right: pip.x + half, top: pip.y - half, bottom: pip.y + half };
}

export function boxesOverlap(a: Box, b: Box): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}
