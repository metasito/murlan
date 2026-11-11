// tests/e2e/helpers/cardContact.ts — a computed `box-shadow` read as its layers, and what a table card's own view
// may cast once the Skia felt draws: a contact, one layer at CardShadow.contact scaled by the table, never a cast.
import type { Page } from "@playwright/test";
import { CardShadow } from "../../../lib/tokens";
import { shadowKind, type ShadowKind, type ShadowPath } from "../../../components/table/cardShadows";
import type { CardRect } from "../../../components/table/cardRects";

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

export type ViewCard = { key: string; kind: CardKind; path: ShadowKind; contacts: number };

/** Glows a table card's own views draw on purpose, by test id: the lit pile card's ring. */
const NAMED_GLOWS = new Set(["pile-card-lit"]);

/**
 * Every view under `scope`, its roots included, read once: each card box with the contacts its own siblings
 * cast, and every other `box-shadow` in the scope. A contact's length is the felt's scale alone, whatever the
 * card's size or transform: a computed `box-shadow` is the view's own, before its transform scales it.
 */
export async function cardViewShadows(page: Page, scope: string): Promise<{ s: number; cards: ViewCard[]; others: string[] }> {
  const read = await page.evaluate((scope) => {
    const felt = (globalThis as unknown as { murlanCardFelt: () => { s: number } }).murlanCardFelt();
    const views = [...new Set([...document.querySelectorAll(scope)].flatMap((r) => [r, ...r.querySelectorAll("*")]))];
    const boxes = views.filter((v) => v.matches('[data-testid="card-box"], [data-testid="card-box-back"]'));
    const cardOf = new Map<Element, number>();
    boxes.forEach((box, i) => {
      for (const sibling of box.parentElement!.children) if (sibling !== box) cardOf.set(sibling, i);
    });
    return {
      s: felt.s,
      cards: boxes.map((box) => ({
        key: box.closest('[id^="card-"]')?.id.slice("card-".length) ?? box.closest('[data-testid^="hand-card-"]')?.getAttribute("data-testid")?.replace("hand-card-", "hand:") ?? "",
        kind: box.getAttribute("data-testid") === "card-box-back" ? ("back" as const) : ("face" as const),
      })),
      shadows: views
        .map((v) => ({ css: getComputedStyle(v).boxShadow, card: cardOf.get(v) ?? -1, id: v.getAttribute("data-testid") ?? "" }))
        .filter((v) => v.css !== "none"),
    };
  }, scope);
  const cards = read.cards.map((c) => ({ ...c, path: shadowKind(c.key, { back: c.kind === "back" } as CardRect), contacts: 0 }));
  const others: string[] = [];
  for (const { css, card, id } of read.shadows) {
    if (card >= 0 && isContact(css, read.s, cards[card].kind)) cards[card].contacts += 1;
    else if (!NAMED_GLOWS.has(id)) others.push(id ? `${id}: ${css}` : css);
  }
  return { s: read.s, cards, others };
}

/** How far the felt is nudged, in px, to make it rebuild what it holds. */
const RESIZE_NUDGE = 8;

/**
 * The paths the felt holds now, and each path's member cards. Its per-cluster build counter only grows, so it
 * is emptied across a resize there and back: a change of felt scale rebuilds every cluster the felt keeps
 * (`tests/native/shadowClusterBuilds.test.tsx`), and what it builds back at this size is what it holds.
 */
export async function feltHolds(page: Page, settle: () => Promise<unknown>): Promise<Partial<Record<ShadowPath, string[]>>> {
  const size = page.viewportSize()!;
  await page.setViewportSize({ width: size.width + RESIZE_NUDGE, height: size.height });
  await settle();
  await page.evaluate(() => void ((globalThis as { murlanShadowClusterBuilds?: Record<string, number> }).murlanShadowClusterBuilds = {}));
  await page.setViewportSize(size);
  await settle();
  const clusters = await page.evaluate(() => Object.keys((globalThis as { murlanShadowClusterBuilds?: Record<string, number> }).murlanShadowClusterBuilds ?? {}));
  const held: Partial<Record<ShadowPath, string[]>> = {};
  for (const cluster of clusters) {
    const [path, members] = cluster.split("|") as [ShadowPath, string];
    held[path] = [...(held[path] ?? []), ...members.split(",").filter(Boolean)];
  }
  if (!held.cast?.length) throw new Error(`the felt rebuilt no cast across a resize, so what it holds is unread (built: ${JSON.stringify(held)})`);
  return held;
}

/** Whether the hand-shade canvas, rather than each card's own view, draws the cards' contact. */
export const SHADE_CANVAS = '[data-testid="card-shade"] canvas';
