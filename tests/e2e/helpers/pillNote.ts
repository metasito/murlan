// What the exchange's note says about itself on the last-played pill: where it sits, what it clears, whether it is cut.
import { expect } from "@playwright/test";

interface Rect { x: number; y: number; width: number; height: number }
export interface PillFacts {
  note: Rect | null;
  pill: Rect | null;
  /** The note's text is cut: it needs more width than it has. */
  truncated: boolean;
  /** Every other HUD piece the pill must clear, by test id. */
  neighbours: Record<string, Rect>;
}

const NEIGHBOURS = ["notice-turn", "score-pill", "control-rail"];

/** Runs in the page. */
export function readPillFacts(neighbourIds: string[]): PillFacts {
  const rect = (el: Element | null): Rect | null => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  };
  const note = document.querySelector('[data-testid="exchange-pill-note"]');
  const neighbours: Record<string, Rect> = {};
  for (const id of neighbourIds) {
    const r = rect(document.querySelector(`[data-testid="${id}"]`));
    if (r && r.width > 0) neighbours[id] = r;
  }
  return {
    note: rect(note),
    pill: rect(document.querySelector('[data-testid="notice-hudCombo"]')),
    truncated: note ? note.scrollWidth > note.clientWidth : false,
    neighbours,
  };
}

export const NEIGHBOUR_IDS = NEIGHBOURS;

const inside = (a: Rect, b: Rect, slop = 1) =>
  a.x >= b.x - slop && a.y >= b.y - slop && a.x + a.width <= b.x + b.width + slop && a.y + a.height <= b.y + b.height + slop;
const apart = (a: Rect, b: Rect) => a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;

/** The note lives inside the last-played pill, the pill touches no other piece of the HUD, nothing is cut, and all of it is on screen. */
export function expectNoteFits(f: PillFacts, window: { width: number; height: number }, what: string) {
  expect(f.note, `${what}: the note is drawn`).not.toBeNull();
  expect(f.pill, `${what}: the last-played pill is drawn`).not.toBeNull();
  expect(inside(f.note!, f.pill!), `${what}: the note is inside the last-played pill`).toBe(true);
  expect(f.truncated, `${what}: the note is cut`).toBe(false);
  expect(inside(f.pill!, { x: 0, y: 0, ...window }), `${what}: the pill is on screen`).toBe(true);
  for (const [id, r] of Object.entries(f.neighbours)) expect(apart(f.pill!, r), `${what}: the pill overlaps ${id}`).toBe(true);
}
