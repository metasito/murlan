// Pure geometry of a card face, kept out of CardView.tsx for the same reason
// gameTableModel.ts is kept out of GameTable.tsx: Node's test loader strips
// plain .ts but cannot parse .tsx, so none of this is reachable from a test
// while it lives next to JSX.
//
// Everything is expressed as a fraction of the card's own width or height, so
// one set of numbers serves both card sizes.

import type { Rank } from "@/lib/gameEngine";

export const CARD_W = 58;
export const CARD_H = 84;
export const CARD_W_SMALL = 40;
export const CARD_H_SMALL = 58;

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
// spills into the pip field. It gets its own size so it fits instead.
export const RANK_FONT = 15;
export const RANK_FONT_SMALL = 11;
export const RANK_FONT_WIDE = 12;
export const RANK_FONT_WIDE_SMALL = 8.5;
const GLYPH_ADVANCE_EM = 0.55;
const LETTER_SPACING = -0.5;

export function isWideRank(rank: string): boolean {
  return rank.length > 1 && rank !== "JK";
}

export function rankFontSize(rank: string, small: boolean): number {
  if (isWideRank(rank)) return small ? RANK_FONT_WIDE_SMALL : RANK_FONT_WIDE;
  return small ? RANK_FONT_SMALL : RANK_FONT;
}

/** Rendered width of a rank's glyphs at the size it is drawn. */
export function rankTextWidth(rank: string, small: boolean): number {
  const size = rankFontSize(rank, small);
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
export function indexBox(rank: string, w: number, h: number, small: boolean): Box {
  const centreX = w * INDEX_X;
  const textHalf = rankTextWidth(rank, small) / 2;
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
