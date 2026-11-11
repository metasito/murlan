// tests/e2e/helpers/cardContact.ts — a computed `box-shadow` read as its layers, and what a table card's own view
// may cast once the Skia felt draws: a contact, one layer at CardShadow.contact scaled by the table, never a cast.
import type { Page } from "@playwright/test";
import { CardShadow, Colors, RoundMoment } from "../../../lib/tokens";
import { shadowKind, type ShadowKind, type ShadowPath } from "../../../components/table/cardShadows";
import type { CardRect } from "../../../components/table/cardRects";

/** Computed `box-shadow` lengths round; a contact at the table's scale is tenths of a point. */
const LENGTH_SLACK = 0.05;
/** A computed alpha rounds to the byte. */
const ALPHA_SLACK = 0.005;

export type ShadowLayer = { colour: string; rgb: number[]; alpha: number; black: boolean; x: number; y: number; blur: number; spread: number; inset: boolean };

/** A computed `box-shadow` as its layers, lengths in the order CSS gives them; `none` has none. */
export function shadowLayers(css: string): ShadowLayer[] {
  if (css === "none") return [];
  return css.split(/,(?![^(]*\))/).map((part) => {
    const colour = /rgba?\([^)]*\)/.exec(part)?.[0] ?? "";
    const [r, g, b, a = 1] = (/\(([^)]*)\)/.exec(colour)?.[1] ?? "").split(",").map(Number);
    const [x = NaN, y = NaN, blur = 0, spread = 0] = part.replace(colour, "").match(/-?[\d.]+(?=px)/g)?.map(Number) ?? [];
    return { colour, rgb: [r, g, b], alpha: a, black: r === 0 && g === 0 && b === 0, x, y, blur, spread, inset: /\binset\b/.test(part) };
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

/** Who draws a table card's contact: a seat fan's is the felt's, every other card's is its own view's. */
export const contactOnFelt = (path: ShadowKind): boolean => path === "fan";

/** The felt's contact paths, those `contactOnFelt` gives it. */
export const FELT_CONTACTS: ShadowPath[] = (["face", "back", "fan"] as const).filter(contactOnFelt);

/** The contacts a card's own view casts: none where the felt draws it. */
export const viewContacts = (card: Pick<ViewCard, "path">): number => (contactOnFelt(card.path) ? 0 : 1);

/** Whether any contact path the felt holds, whatever its kind, holds `key`; the cast is not a contact. */
export const feltContactHolds = (held: Partial<Record<ShadowPath, string[]>>, key: string): boolean =>
  Object.entries(held).some(([path, keys]) => path !== "cast" && keys.includes(key));

const LIT_RGB = (Colors.goldLit.match(/[\da-f]{2}/gi) ?? []).map((h) => parseInt(h, 16));

/** True when `css` is the lit pile card's ring (`Shadow.litCard`): one unscaled goldLit glow. */
function isLitGlow(css: string): boolean {
  const l = shadowLayers(css);
  if (l.length !== 1) return false;
  const [c] = l;
  return c.rgb.join() === LIT_RGB.join() && c.alpha === 1 && !c.inset && c.x === 0 && c.y === 0 && c.spread === 0 && c.blur === RoundMoment.litGlowPt;
}

/**
 * Every view under `scope`, its roots included, read once: each card box with the contacts its own siblings
 * cast, and every other `box-shadow` in the scope. A contact's length is the felt's scale alone, whatever the
 * card's size or transform: a computed `box-shadow` is the view's own, before its transform scales it.
 */
export async function cardViewShadows(page: Page, scope: string): Promise<{ cards: ViewCard[]; others: string[] }> {
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
    else if (!(id === "pile-card-lit" && isLitGlow(css))) others.push(id ? `${id}: ${css}` : css);
  }
  return { cards, others };
}

/** How far the felt is nudged, in px, to make it rebuild what it holds. */
const RESIZE_NUDGE = 8;

/**
 * The paths the felt holds now, and each path's member cards. Its per-cluster build counter only grows, so it
 * is emptied across a resize there and back: a change of felt scale rebuilds every cluster the felt keeps
 * (`tests/native/shadowClusterBuilds.test.tsx`), and what it builds back at this size is what it holds.
 * Each of `draws`, the paths the felt draws on this table, must come back built, or a path left unbuilt by a
 * reaction that did not rerun would read as holding nothing.
 */
export async function feltHolds(page: Page, settle: () => Promise<unknown>, draws: readonly ShadowPath[]): Promise<Partial<Record<ShadowPath, string[]>>> {
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
  const unbuilt = ["cast" as const, ...draws].filter((path) => !held[path]?.length);
  if (unbuilt.length) throw new Error(`the felt rebuilt no ${unbuilt.join(", ")} across a resize, so what it holds is unread (built: ${JSON.stringify(held)})`);
  return held;
}
