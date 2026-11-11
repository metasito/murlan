// tests/e2e/helpers/cardContact.ts — a computed `box-shadow` read as its layers, and what a table card's own view
// may cast once the Skia felt draws: a contact, one layer at CardShadow.contact scaled by the table, never a cast.
import type { Page } from "@playwright/test";
import { CardShadow } from "../../../lib/tokens";

/** Computed `box-shadow` lengths round; a contact at the table's scale is tenths of a point. */
const LENGTH_SLACK = 0.05;
/** A computed alpha rounds to the byte. */
const ALPHA_SLACK = 0.005;

export type ShadowLayer = { colour: string; alpha: number; black: boolean; x: number; y: number; blur: number; spread: number; inset: boolean };

/** A computed `box-shadow` as its layers, lengths in the order CSS gives them; `none` has none. */
export function shadowLayers(css: string): ShadowLayer[] {
  if (css === "none") return [];
  return css.split(/,(?![^(]*\))/).map((part) => {
    const colour = /rgba?\([^)]*\)/.exec(part)?.[0] ?? "";
    const [r, g, b, a = 1] = (/\(([^)]*)\)/.exec(colour)?.[1] ?? "").split(",").map(Number);
    const [x = NaN, y = NaN, blur = 0, spread = 0] = part.replace(colour, "").match(/-?[\d.]+(?=px)/g)?.map(Number) ?? [];
    return { colour, alpha: a, black: r === 0 && g === 0 && b === 0, x, y, blur, spread, inset: /\binset\b/.test(part) };
  });
}

export type CardKind = "face" | "back";

/** True when `css` is the contact of a card of `kind` alone, at table scale `s`. */
export function isContact(css: string, s: number, kind: CardKind): boolean {
  const l = shadowLayers(css);
  if (l.length !== 1) return false;
  const [c] = l;
  const near = (v: number, want: number, slack = LENGTH_SLACK) => Math.abs(v - want) <= slack;
  return (
    c.black &&
    !c.inset &&
    near(c.x, 0) &&
    near(c.spread, 0) &&
    near(c.y, CardShadow.contact.y * s) &&
    near(c.blur, CardShadow.contact.blur * s) &&
    near(c.alpha, CardShadow.alpha[kind], ALPHA_SLACK)
  );
}

export type CardViewShadows = { kind: CardKind; box: string; shadows: string[] };

/** Each card under `scope`: its kind, its `card-box`'s `box-shadow`, and every non-`none` one on its views, with the felt's scale. */
export function cardViewShadows(page: Page, scope: string): Promise<{ s: number; cards: CardViewShadows[] }> {
  return page.evaluate((scope) => {
    const felt = (globalThis as unknown as { murlanCardFelt: () => { s: number } }).murlanCardFelt();
    const boxes = [...document.querySelectorAll(scope)].flatMap((r) => [
      ...(r.matches('[data-testid="card-box"], [data-testid="card-box-back"]') ? [r] : []),
      ...r.querySelectorAll('[data-testid="card-box"], [data-testid="card-box-back"]'),
    ]);
    const cards = new Map<Element, Element>();
    for (const box of boxes) cards.set(box.parentElement!, box);
    return {
      s: felt.s,
      cards: [...cards].map(([root, box]) => ({
        kind: box.getAttribute("data-testid") === "card-box-back" ? ("back" as const) : ("face" as const),
        box: getComputedStyle(box).boxShadow,
        shadows: [root, ...root.querySelectorAll("*")].map((v) => getComputedStyle(v).boxShadow).filter((s) => s !== "none"),
      })),
    };
  }, scope);
}

/** How many of a card's shadows are its contact, and which are anything else: the card's box, which clips to its corners, casts none of its own. */
export function contactsOf(card: CardViewShadows, s: number): { contacts: number; others: string[] } {
  const own = card.box === "none" ? [] : [card.box];
  const rest = [...card.shadows];
  if (own.length) rest.splice(rest.indexOf(card.box), 1);
  const others = [...own, ...rest.filter((css) => !isContact(css, s, card.kind))];
  return { contacts: card.shadows.length - others.length, others };
}

/** Whether the hand-shade canvas, rather than each card's own view, draws the cards' contact. */
export const SHADE_CANVAS = '[data-testid="card-shade"] canvas';
