// How wide a table notice is, before it renders: the measured runs (textMetrics.generated.ts) in the
// notice's own box (noticeModel.ts). An upper bound wherever the words exist only at render time.
//
// JSX-free, runtime imports relative — docs/agents/checks.md, "Node's TypeScript loader".

import { mockupPx, noticeBox, noticeRun, NOTICE_KEY, type NoticeBox, type NoticeKind, type NoticeRole } from "./noticeModel.ts";
import { TEXT_METRICS } from "./textMetrics.generated.ts";

export type NoticeLocale = keyof typeof TEXT_METRICS.runs;

/**
 * One child of a notice's plate, in drawing order. A `run` is `${role}:${catalogue key}` as
 * `TEXT_METRICS` names it, with the words each template slot is filled with; a `runtime` run is
 * words only render time knows, priced as `text` when the state has it and at the kind's bound when not.
 */
export type NoticePart =
  | { run: string; slots?: readonly string[] }
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
  return { upem: face.upem, widest: face.widestGlyph, digit: face.tabularDigit, tabular: run.tabular, advances, upper: run.upper, size, tracking };
}

/**
 * Where a renderer has no subpixel positioning (Chrome's Linux headless shell, hinted Linux
 * desktops) every glyph's advance lands on a whole pixel, up to the next one, so a glyph is priced
 * there: the linear advance alone undercounts that renderer.
 */
const snapped = (px: number): number => Math.ceil(px);

/** What snapping can add to a run already shaped as one sum: under a pixel per glyph. */
const SNAP_PER_GLYPH = 1;

/** Words shaped glyph by glyph, without kerning; a glyph the subset lacks is priced at the face's widest. */
export function wordsWidth(
  g: { upem: number; widest: number; advances: Readonly<Record<string, number>>; upper: boolean; size: number; tracking: number },
  locale: NoticeLocale,
  words: string
): number {
  const chars = [...(g.upper ? words.toLocaleUpperCase(locale) : words)];
  const glyphs = chars.reduce((sum, ch) => sum + snapped(((g.advances[ch] ?? g.widest) / g.upem) * g.size), 0);
  return glyphs + chars.length * g.tracking;
}

/** `wordsWidth` in one of the notice faces, for words set outside a notice. */
export function faceWordsWidth(face: keyof typeof TEXT_METRICS.faces, set: { size: number; tracking: number; upper: boolean }, locale: NoticeLocale, words: string): number {
  const f = TEXT_METRICS.faces[face];
  return wordsWidth({ upem: f.upem, widest: f.widestGlyph, advances: f.advances, ...set }, locale, words);
}

function runtimeWidth(kind: NoticeKind, locale: NoticeLocale, box: NoticeBox, role: NoticeRole, scale: number, text: string | undefined): number {
  const bound = box.runtime[role];
  if (!bound) throw new Error(`${kind} has no runtime ${role} run`);
  const g = glyphs(box, role, scale);
  if ("chars" in bound) {
    const chars = text === undefined ? undefined : [...text].slice(0, bound.chars);
    if (chars === undefined || g.tabular) return (chars?.length ?? bound.chars) * (snapped(((g.tabular ? g.digit : g.widest) / g.upem) * g.size) + g.tracking);
    return wordsWidth(g, locale, chars.join(""));
  }
  return Math.min(text === undefined ? Infinity : wordsWidth(g, locale, text), bound.maxWidth);
}

function runWidth(kind: NoticeKind, locale: NoticeLocale, box: NoticeBox, id: string, slots: readonly string[], scale: number): number {
  const measured = (TEXT_METRICS.runs[locale] as Record<string, Record<string, Measured | undefined>>)[kind][id];
  if (!measured) throw new Error(`${locale} measures no "${id}" for ${kind}`);
  const role = id.slice(0, id.indexOf(":")) as NoticeRole;
  const g = glyphs(box, role, scale);
  const text =
    (measured.units / g.upem) * g.size +
    measured.fallback.length * g.size +
    measured.chars * (g.tracking + SNAP_PER_GLYPH) +
    slots.reduce((sum, words) => sum + wordsWidth(g, locale, words), 0);
  return role === "key" ? text + 2 * mockupPx(NOTICE_KEY.padX, scale) : text;
}

/** The plate's outer width: border, padding, then its children a `gap` apart. */
export function noticeWidth(kind: NoticeKind, locale: NoticeLocale, scale: number, content: NoticeContent): number {
  const box = noticeBox(kind, scale);
  const widths = content.map((part) =>
    "dot" in part
      ? box.dot
      : "run" in part
        ? runWidth(kind, locale, box, part.run, part.slots ?? [], scale)
        : runtimeWidth(kind, locale, box, part.runtime, scale, part.text)
  );
  const inner = widths.reduce((sum, w) => sum + w, 0) + box.gap * Math.max(0, widths.length - 1);
  const wide = 2 * (box.padX + PLATE_BORDER) + inner;
  return box.maxWidth === undefined ? wide : Math.min(wide, box.maxWidth);
}

/** `TableNotice`'s plate border, which `box-sizing` counts inside the width. */
export const PLATE_BORDER = 1;
