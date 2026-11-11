// tests/e2e/helpers/cardContact.ts — what a table card's own view may cast once the Skia felt draws: a contact,
// one layer at CardShadow.contact scaled by the table, never a cast of its own (the felt draws that).
import type { Page } from "@playwright/test";
import { CardShadow } from "../../../lib/tokens";

/** Computed `box-shadow` lengths round; a contact at the table's scale is tenths of a point. */
const SLACK = 0.05;

type Layer = { alpha: number; black: boolean; x: number; y: number; blur: number; spread: number; inset: boolean };

function layers(css: string): Layer[] {
  if (css === "none") return [];
  return css.split(/,(?![^(]*\))/).map((part) => {
    const [r, g, b, a = 1] = (/rgba?\(([^)]*)\)/.exec(part)?.[1] ?? "").split(",").map(Number);
    const [x = NaN, y = NaN, blur = 0, spread = 0] = part.replace(/rgba?\([^)]*\)/, "").match(/-?[\d.]+(?=px)/g)?.map(Number) ?? [];
    return { alpha: a, black: r === 0 && g === 0 && b === 0, x, y, blur, spread, inset: /\binset\b/.test(part) };
  });
}

/** True when `css` is a card's contact alone at table scale `s`: a face's or a back's. */
export function isContact(css: string, s: number): boolean {
  const l = layers(css);
  if (l.length !== 1) return false;
  const [c] = l;
  const near = (v: number, want: number) => Math.abs(v - want) <= SLACK;
  return (
    c.black &&
    !c.inset &&
    near(c.x, 0) &&
    near(c.spread, 0) &&
    near(c.y, CardShadow.contact.y * s) &&
    near(c.blur, CardShadow.contact.blur * s) &&
    [CardShadow.alpha.face, CardShadow.alpha.back].some((a) => near(c.alpha, a))
  );
}

/** Every non-`none` `box-shadow` on the views of the cards under `scope`, with the felt's scale. */
export function cardViewShadows(page: Page, scope: string): Promise<{ views: number; s: number; shadows: string[] }> {
  return page.evaluate((scope) => {
    const felt = (globalThis as unknown as { murlanCardFelt: () => { s: number } }).murlanCardFelt();
    const roots = [...document.querySelectorAll(scope)];
    const views = new Set(roots.flatMap((r) => [r, ...r.querySelectorAll("*")]));
    return { views: views.size, s: felt.s, shadows: [...views].map((v) => getComputedStyle(v).boxShadow).filter((s) => s !== "none") };
  }, scope);
}
