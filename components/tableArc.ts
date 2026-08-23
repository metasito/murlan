// Every arc on the table: a hand, an opponent's fan of backs, a combination on
// the felt. One solve, three callers, no special case between one card and
// thirteen.
//
// JSX-free and importing nothing from a .tsx file, for the same reason
// components/handLayout.ts is: `node --test` type-strips plain .ts only.

/** Where one card sits in an arc, relative to the arc's own midpoint. */
export interface ArcCard {
  /** Left edge, from the arc's midpoint. */
  x: number;
  /** Top edge, from the arc's own top. */
  y: number;
  /** The card's own tilt, in degrees. */
  rot: number;
}

export interface ArcBox {
  /** Left edge of the leftmost card to the right edge of the rightmost. */
  w: number;
  /** The card's own height plus the rise the outermost card climbs to. */
  h: number;
}

export interface ArcSpec {
  /** Radius of the circle the cards' midpoints ride. Larger is flatter. */
  radius: number;
  /** Total angle (deg) from the first card to the last. */
  spread: number;
  cardW: number;
  cardH: number;
  /**
   * Open the arc toward its own player rather than away — a bowl, not a dome.
   * Flips the offsets, never the container: the arc deliberately overflows its
   * box, so rotating the container leaves half of it empty and opens a phantom
   * gap between the avatar and the cards.
   */
  flip?: boolean;
}

/**
 * The spread (deg) an arc of `n` cards may take, solved against **two** limits
 * — the width it is allowed and the vertical rise it is allowed — taking the
 * smaller. Height is what a landscape phone is short of, and flattening the
 * curve buys width at the same vertical cost, so solving for width alone
 * leaves a long run width-starved because the rise budget bound first.
 */
export function fitSpread(
  n: number,
  opts: {
    radius: number;
    cardW: number;
    /** Width share of the table this arc is allowed. */
    room: number;
    /** Ideal distance between adjacent cards, before any budget applies. */
    step: number;
    /** How far the outermost card may climb above the middle one. */
    rise: number;
  }
): number {
  if (n < 2) return 0;
  const { radius, cardW, room, step, rise } = opts;
  const width = Math.min(cardW + step * (n - 1), Math.max(cardW + 8, room));
  const byWidth = 2 * Math.asin(Math.min(1, (width - cardW) / (2 * radius)));
  const byRise = 2 * Math.acos(Math.max(-1, 1 - rise / radius));
  return (Math.min(byWidth, byRise) * 180) / Math.PI;
}

/**
 * Lays `n` cards along the arc. The returned box is what the cards span, which
 * is not what the container has to be — see `arcBounds`.
 */
export function arcCards(n: number, spec: ArcSpec): { cards: ArcCard[]; box: ArcBox } {
  const { radius, spread, cardW, cardH, flip = false } = spec;
  if (n <= 0) return { cards: [], box: { w: 0, h: 0 } };

  const points = Array.from({ length: n }, (_, i) => {
    const t = n === 1 ? 0 : -spread / 2 + (spread * i) / (n - 1);
    const rad = (t * Math.PI) / 180;
    return { t, x: radius * Math.sin(rad), y: radius * (1 - Math.cos(rad)) };
  });
  const maxY = Math.max(...points.map((p) => p.y));
  const xs = points.map((p) => p.x);

  const cards = points.map(({ t, x, y }) => ({
    x: x - cardW / 2,
    y: flip ? -y : y - maxY,
    rot: flip ? -t : t,
  }));
  return {
    cards,
    box: { w: Math.max(...xs) - Math.min(...xs) + cardW, h: cardH + maxY },
  };
}

export interface ArcBounds {
  /** The cards' real extent, both axes. */
  w: number;
  h: number;
  /** Its centre, in the arc box's own coordinates. */
  cx: number;
  cy: number;
}

/**
 * What the cards actually occupy, derived from the arc rather than measured.
 * A fan is rotated about this and not about its box, because the arc overflows
 * its own container — and reading it back with a layout measurement is a bug:
 * the measurement returns the rotation the current pass is about to replace,
 * so the fan creeps a little on every relayout.
 *
 * `cards[i].x` is relative to the box's midpoint, matching `arcCards`.
 */
export function arcBounds(
  cards: readonly ArcCard[],
  box: ArcBox,
  cardW: number,
  cardH: number
): ArcBounds {
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const card of cards) {
    const rad = (card.rot * Math.PI) / 180;
    const co = Math.abs(Math.cos(rad));
    const si = Math.abs(Math.sin(rad));
    // Half-extents of the card's own rotated bounding box.
    const hx = (cardW * co + cardH * si) / 2;
    const hy = (cardW * si + cardH * co) / 2;
    const px = box.w / 2 + card.x + cardW / 2;
    const py = card.y + cardH / 2;
    x0 = Math.min(x0, px - hx);
    x1 = Math.max(x1, px + hx);
    y0 = Math.min(y0, py - hy);
    y1 = Math.max(y1, py + hy);
  }
  return { w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}

// ─── Budgets ──────────────────────────────────────────────────────────────────
//
// One place per arc for the shape it wants, so no caller writes a spread out
// for itself. `radius` and `rise` are at scale 1 and are multiplied by the
// card's own scale; `stepRatio` is a fraction of that card's width, so the
// ideal overlap tracks the card rather than the device.

export interface ArcBudget {
  radius: number;
  stepRatio: number;
  rise: number;
}

/** The viewer's own hand: nearly flat, so the width budget is what binds. */
export const HAND_ARC: ArcBudget = { radius: 2200, stepRatio: 0.68, rise: 15 };
/** A combination lying on the felt — flatter still than a held hand. */
export const FIELD_ARC: ArcBudget = { radius: 1100, stepRatio: 0.52, rise: 13 };
/** An opponent's backs: a tight bowl, bound by its rise rather than its width. */
export const SEAT_ARC: ArcBudget = { radius: 150, stepRatio: 1 / 3, rise: 16 };

/**
 * One arc, solved against its budget. `room` is the width share this arc is
 * allowed; pass Infinity for an arc nothing bounds horizontally. `step`
 * overrides the budget's ideal — the hand passes its own overlap floor, which
 * is set by the thumb rather than by looks.
 */
export function solveArc(
  n: number,
  opts: {
    budget: ArcBudget;
    cardW: number;
    cardH: number;
    /** The card's own scale, which the radius and the rise are quoted against. */
    scale: number;
    room: number;
    step?: number;
    flip?: boolean;
  }
): { cards: ArcCard[]; box: ArcBox } {
  const { budget, cardW, cardH, scale, room, step, flip } = opts;
  const radius = budget.radius * scale;
  const spread = fitSpread(n, {
    radius,
    cardW,
    room,
    step: step ?? cardW * budget.stepRatio,
    rise: budget.rise * scale,
  });
  return arcCards(n, { radius, spread, cardW, cardH, flip });
}
