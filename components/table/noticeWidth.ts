// How wide a table notice is, before it renders: the measured runs (textMetrics.generated.ts) in the
// notice's own box (noticeModel.ts). An upper bound wherever the words exist only at render time.
//
// JSX-free, runtime imports relative — docs/agents/checks.md, "Node's TypeScript loader".

import { mockupPx, noticeBox, noticeRun, NOTICE_KEY, type NoticeBox, type NoticeKind, type NoticeRole } from "./noticeModel.ts";
import { TEXT_METRICS } from "./textMetrics.generated.ts";

export type NoticeLocale = keyof typeof TEXT_METRICS.runs;

/** `${role}:${catalogue key}` as `TEXT_METRICS` names it, with the words each template slot is filled with. */
export type CatalogueRun = { run: string; slots?: readonly string[] };

/**
 * One child of a notice's plate, in drawing order: catalogue `runs` set as one text, or a `runtime`
 * run of words only render time knows, priced as `text` when the state has it and at the kind's bound when not.
 */
export type NoticePart =
  | { runs: readonly CatalogueRun[] }
  | { runtime: NoticeRole; text?: string }
  | { dot: true };

export type NoticeContent = readonly NoticePart[];

interface Measured {
  face: keyof typeof TEXT_METRICS.faces;
  units: number;
  chars: number;
  fallback: readonly string[];
}

function glyphs(box: NoticeBox, role: NoticeRole, scale: number) {
  const run = noticeRun(box, role);
  const face = TEXT_METRICS.faces[run.face];
  const strong = role === "strong";
  const size = strong ? box.strongFontSize : box.fontSize;
  const tracking = role === "key" ? mockupPx(NOTICE_KEY.tracking, scale) : strong ? box.strongTracking : box.tracking;
  const advances: Readonly<Record<string, number>> = face.advances;
  const digits: Readonly<Record<string, number>> = face.tabularDigits;
  return { upem: face.upem, widest: face.widestGlyph, digit: face.tabularDigit, digits, tabular: run.tabular, advances, upper: run.upper, size, tracking };
}

/**
 * Where a renderer has no subpixel positioning (Chrome's Linux headless shell, hinted Linux
 * desktops) every glyph's advance lands on a whole pixel, up to the next one, so a glyph is priced
 * there: the linear advance alone undercounts that renderer.
 */
const snapped = (px: number): number => Math.ceil(px);

/**
 * What a run already shaped as one sum is priced per glyph for snapping: a whole pixel, the most a
 * glyph's advance can gain landing on the next one, since the sum no longer holds each advance.
 */
export const SNAP_PER_GLYPH = 1;

/**
 * `snapped` prices what a snapping renderer may draw; `linear` the same words at their linear
 * advances, which is what a renderer positioning by subpixel draws. A fallback glyph is its `TEXT_METRICS.fallbackEm` in both.
 */
export type Pricing = "snapped" | "linear";

const advance = (pricing: Pricing) => (pricing === "snapped" ? snapped : (px: number) => px);

/** Words shaped glyph by glyph, without kerning; a glyph the subset lacks is priced at the face's widest. */
export function wordsWidth(
  g: { upem: number; widest: number; advances: Readonly<Record<string, number>>; upper: boolean; size: number; tracking: number },
  locale: NoticeLocale,
  words: string,
  pricing: Pricing = "snapped"
): number {
  const chars = [...(g.upper ? words.toLocaleUpperCase(locale) : words)];
  const glyphs = chars.reduce((sum, ch) => sum + advance(pricing)(((g.advances[ch] ?? g.widest) / g.upem) * g.size), 0);
  return glyphs + chars.length * g.tracking;
}

/** `wordsWidth` in one of the notice faces, for words set outside a notice. */
export function faceWordsWidth(face: keyof typeof TEXT_METRICS.faces, set: { size: number; tracking: number; upper: boolean }, locale: NoticeLocale, words: string, pricing: Pricing = "snapped"): number {
  const f = TEXT_METRICS.faces[face];
  return wordsWidth({ upem: f.upem, widest: f.widestGlyph, advances: f.advances, ...set }, locale, words, pricing);
}

function runtimeWidth(kind: NoticeKind, locale: NoticeLocale, box: NoticeBox, role: NoticeRole, scale: number, text: string | undefined, pricing: Pricing): number {
  const bound = box.runtime[role];
  if (!bound) throw new Error(`${kind} has no runtime ${role} run`);
  const g = glyphs(box, role, scale);
  if ("chars" in bound) {
    const chars = text === undefined ? undefined : [...text].slice(0, bound.chars);
    if (chars === undefined) return bound.chars * (advance(pricing)(((g.tabular ? g.digit : g.widest) / g.upem) * g.size) + g.tracking);
    return wordsWidth(g.tabular ? { ...g, advances: { ...g.advances, ...g.digits } } : g, locale, chars.join(""), pricing);
  }
  return Math.min(text === undefined ? Infinity : wordsWidth(g, locale, text, pricing), bound.maxWidth);
}

function runWidth(kind: NoticeKind, locale: NoticeLocale, box: NoticeBox, id: string, slots: readonly string[], scale: number, pricing: Pricing): number {
  const measured = (TEXT_METRICS.runs[locale] as Record<string, Record<string, Measured | undefined>>)[kind][id];
  if (!measured) throw new Error(`${locale} measures no "${id}" for ${kind}`);
  const role = id.slice(0, id.indexOf(":")) as NoticeRole;
  const g = glyphs(box, role, scale);
  const text =
    (measured.units / g.upem) * g.size +
    measured.fallback.reduce((sum, cp) => sum + (TEXT_METRICS.fallbackEm as Readonly<Record<string, number>>)[cp]! * g.size, 0) +
    measured.chars * (g.tracking + (pricing === "snapped" ? SNAP_PER_GLYPH : 0)) +
    slots.reduce((sum, words) => sum + wordsWidth(g, locale, words, pricing), 0);
  return role === "key" ? text + 2 * mockupPx(NOTICE_KEY.padX, scale) : text;
}

/** The plate's outer width: border, padding, then its children a `gap` apart. */
export function noticeWidth(kind: NoticeKind, locale: NoticeLocale, scale: number, content: NoticeContent, pricing: Pricing = "snapped", room?: number): number {
  const box = noticeBox(kind, scale, room);
  const widths = content.map((part) =>
    "dot" in part
      ? box.dot
      : "runs" in part
        ? part.runs.reduce((sum, r) => sum + runWidth(kind, locale, box, r.run, r.slots ?? [], scale, pricing), 0)
        : runtimeWidth(kind, locale, box, part.runtime, scale, part.text, pricing)
  );
  const inner = widths.reduce((sum, w) => sum + w, 0) + box.gap * Math.max(0, widths.length - 1);
  const wide = 2 * (box.padX + PLATE_BORDER) + inner;
  return box.maxWidth === undefined ? wide : Math.min(wide, box.maxWidth);
}

/** `TableNotice`'s plate border, which `box-sizing` counts inside the width. */
export const PLATE_BORDER = 1;
