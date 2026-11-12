// Reading the table the browser drew against the rects `tableRects` solved: the selectors each rect is
// drawn by, the union of what they match, and how each box is held to its rect.
import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { fits, type Box, type Fit } from "../../helpers/drawnFit";
import type { Rect, RectName, TableRects } from "../../../components/tableRects";

export const DRAWN: Partial<Record<RectName, { sel: string; fit: Fit }>> = {
  rail: { sel: '[data-testid="control-rail"]', fit: "same" },
  railMenu: { sel: '[data-testid="control-rail"] > div:first-child [role="button"]', fit: "same" },
  hudCombo: { sel: '[data-testid="notice-hudCombo"]', fit: "words" },
  hudTurn: { sel: '[data-testid="notice-turn"]', fit: "words" },
  pileNote: { sel: '[data-testid="notice-pileNote"]', fit: "words" },
  scorePill: { sel: '[data-testid="score-pill-plate"]', fit: "same" },
  seatTop: { sel: '[data-testid="top-seat"] [data-testid="seat-ring"]', fit: "same" },
  seatLeft: { sel: '[data-testid="side-seat-left"] [data-testid="seat-ring"]', fit: "same" },
  seatRight: { sel: '[data-testid="side-seat-right"] [data-testid="seat-ring"]', fit: "same" },
  nameTop: { sel: '[data-testid="top-seat"] [data-testid="seat-name"]', fit: "line" },
  nameLeft: { sel: '[data-testid="side-seat-left"] [data-testid="seat-name"]', fit: "line" },
  nameRight: { sel: '[data-testid="side-seat-right"] [data-testid="seat-name"]', fit: "line" },
  fanTop: { sel: '[data-testid="top-seat"] [data-testid="seat-back"]', fit: "same" },
  fanLeft: { sel: '[data-testid="side-seat-left"] [data-testid="seat-back"]', fit: "same" },
  fanRight: { sel: '[data-testid="side-seat-right"] [data-testid="seat-back"]', fit: "same" },
  pile: { sel: '[data-testid="pile-card"]', fit: "same" },
  handZone: { sel: '[data-testid="hand-zone"]', fit: "same" },
  passa: { sel: '[data-testid="btn-passa-box"]', fit: "same" },
  gioca: { sel: '[data-testid="btn-gioca-box"]', fit: "same" },
  hand: { sel: '[data-testid="hand-row"] [data-testid="card-box"]', fit: "same" },
};
export const BADGE_SEL = ':is([data-testid="notice-reconnecting"], [data-testid="notice-vacated"])';
/** The seats' rings, names and badges: what a badge moves, and the badge itself. */
export const BADGES: Partial<Record<RectName, { sel: string; fit: Fit }>> = {
  ...Object.fromEntries((["seatTop", "seatLeft", "seatRight", "nameTop", "nameLeft", "nameRight"] as const).map((name) => [name, DRAWN[name]!])),
  badgeTop: { sel: `[data-testid="top-seat"] ${BADGE_SEL}`, fit: "words" },
  badgeLeft: { sel: `[data-testid="side-seat-left"] ${BADGE_SEL}`, fit: "words" },
  badgeRight: { sel: `[data-testid="side-seat-right"] ${BADGE_SEL}`, fit: "words" },
};
/** The rail's foot holds a knob only on the online table, where the reactions trigger takes it. */
export const RAIL: Partial<Record<RectName, { sel: string; fit: Fit }>> = {
  rail: DRAWN.rail,
  railMenu: DRAWN.railMenu,
  railFoot: { sel: '[data-testid="control-rail"] > div:last-child [role="button"]', fit: "same" },
};
export interface Drawn { boxes: Partial<Record<RectName, Box>>; clip: Rect | null; texts: { combo: string; turn: string; note: string } }

/** Each rect as the union of what its selector matched; a scrolled hand as the part its window shows. */
export async function drawn(page: Page, rects: Partial<Record<RectName, { sel: string; fit: Fit }>>): Promise<Drawn> {
  return page.evaluate((specs: Record<string, { sel: string; fit: Fit }>) => {
    /** Words at linear advances: set LARGE times over in the same face, case, tracking and features, a hinted advance is off by a LARGEth of a pixel. */
    const LARGE = 64;
    const linear = (el: Element, words: string) => {
      const cs = getComputedStyle(el);
      const probe = document.createElement("span");
      Object.assign(probe.style, {
        position: "absolute",
        visibility: "hidden",
        whiteSpace: "pre",
        fontFamily: cs.fontFamily,
        fontWeight: cs.fontWeight,
        fontStyle: cs.fontStyle,
        fontVariantNumeric: cs.fontVariantNumeric,
        fontFeatureSettings: cs.fontFeatureSettings,
        fontKerning: cs.fontKerning,
        textTransform: cs.textTransform,
        fontSize: `${parseFloat(cs.fontSize) * LARGE}px`,
        letterSpacing: `${(parseFloat(cs.letterSpacing) || 0) * LARGE}px`,
      });
      probe.lang = el.closest("[lang]")?.getAttribute("lang") ?? "";
      probe.textContent = words;
      document.body.appendChild(probe);
      const w = probe.getBoundingClientRect().width / LARGE;
      probe.remove();
      return w;
    };
    const union = (rs: DOMRect[]) => {
      const live = rs.filter((r) => r.width > 0 && r.height > 0);
      if (live.length === 0) return null;
      const x = Math.min(...live.map((r) => r.left));
      const y = Math.min(...live.map((r) => r.top));
      return { x, y, w: Math.max(...live.map((r) => r.right)) - x, h: Math.max(...live.map((r) => r.bottom)) - y };
    };
    const boxes: Record<string, Box> = {};
    for (const [name, { sel, fit }] of Object.entries(specs)) {
      const els = [...document.querySelectorAll(sel)];
      const r = union(els.map((e) => e.getBoundingClientRect()));
      if (!r) continue;
      boxes[name] = r;
      if (fit === "same") continue;
      const sizes = els.flatMap((e) => [e, ...e.querySelectorAll("*")]).map((e) => parseFloat(getComputedStyle(e).fontSize));
      let [drawnW, linearW] = [0, 0];
      for (const e of els)
        for (let walk = document.createTreeWalker(e, NodeFilter.SHOW_TEXT), node = walk.nextNode(); node; node = walk.nextNode()) {
          if (!node.textContent) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          drawnW += range.getBoundingClientRect().width;
          linearW += linear(node.parentElement!, node.textContent);
        }
      boxes[name].text = { words: els.map((e) => e.textContent ?? "").join(""), em: Math.max(...sizes), drawn: drawnW, linear: linearW };
    }
    const window = document.querySelector('[data-testid="hand-window"]');
    const c = window && getComputedStyle(window).overflowX !== "visible" ? window.getBoundingClientRect() : null;
    return {
      boxes,
      clip: c && { x: c.left, y: c.top, w: c.width, h: c.height },
      texts: {
        combo: document.querySelector('[data-testid="notice-hudCombo"]')?.textContent ?? "",
        turn: document.querySelector('[data-testid="notice-turn"]')?.textContent ?? "",
        note: document.querySelector('[data-testid="notice-pileNote"]')?.textContent ?? "",
      },
    };
  }, rects as Record<string, { sel: string; fit: Fit }>) as Promise<Drawn>;
}

export async function settled(page: Page, rects = DRAWN): Promise<Drawn> {
  let previous = "";
  await expect
    .poll(
      async () => {
        const now = JSON.stringify(await drawn(page, rects));
        const still = now === previous;
        previous = now;
        return still;
      },
      { message: "the table never came to rest", timeout: 15_000, intervals: [250] }
    )
    .toBe(true);
  return drawn(page, rects);
}

const clipTo = (r: Rect, c: Rect | null): Rect => {
  if (!c) return r;
  const x = Math.max(r.x, c.x);
  const y = Math.max(r.y, c.y);
  return { x, y, w: Math.min(r.x + r.w, c.x + c.w) - x, h: Math.min(r.y + r.h, c.y + c.h) - y };
};
const at = (r: Rect) => `${r.x.toFixed(1)},${r.y.toFixed(1)} ${r.w.toFixed(1)}x${r.h.toFixed(1)}`;

export function misfits(got: Drawn, want: TableRects, rects = DRAWN): string[] {
  const bad: string[] = [];
  const combo = [want.rects.hudCombo, got.boxes.hudCombo];
  const drift = combo[0] && combo[1] ? Math.max(0, combo[0].w - combo[1].w) : 0;
  for (const [name, spec] of Object.entries(rects) as [RectName, { fit: Fit }][]) {
    const solved = want.rects[name];
    const raw = got.boxes[name];
    const box = raw && name === "hand" ? { ...raw, ...clipTo(raw, got.clip) } : raw;
    if (!solved !== !box) bad.push(`${name}: drawn ${box ? at(box) : "nothing"}, solver ${solved ? at(solved) : "nothing"}`);
    else if (solved && box && !fits[spec.fit](box, solved, { align: want.aligns[name], overcount: want.overcount[name], capped: want.capped[name], drift: name === "hudTurn" && want.aligns.hudTurn !== "center" ? drift : undefined })) {
      const words = box.text && ` (words ${box.text.drawn.toFixed(1)} drawn, ${box.text.linear.toFixed(1)} linear; overcount ${want.overcount[name]?.toFixed(1)})`;
      bad.push(`${name}: drawn ${at(box)}, solver ${at(solved)}${words ?? ""}`);
    }
  }
  return bad;
}

