// JSX-free, runtime imports relative — docs/agents/checks.md, "Node's TypeScript loader".
import { Motion, motionMs, Radius, type NoticePalette } from "../../lib/tokens.ts";
import { cardScale, tableFontSize } from "../cardFaceModel.ts";
import { CHIP_H } from "../seatLayout.ts";

export type NoticeShape = "pill" | "chip" | "float" | "panel";
export type NoticeTone = "neutral" | "lit" | "urgent" | "ok" | "bad" | "gold";
export type ToneOf<S extends NoticeShape> = keyof (typeof NoticePalette)[S] & NoticeTone;

const FULL = "full";
const CHIP = { height: FULL, padX: 12, gapX: 6, radius: FULL, font: 10, weight: 600, tracking: 1.55 } as const;
const EXTRA_PILL = { ...CHIP, gapX: 7 } as const;

const MOCKUP = {
  ".chip": CHIP,
  "#turn": { ...CHIP, padX: 13, gapX: 7, strongFont: 12 },
  ".floatchip": CHIP,
  // content-box: 15 px and its two 1 px edges
  ".passo": { height: 17, padX: 7, gapX: 0, radius: 8, font: 8, weight: 700, tracking: 1.28 },
  ".cchip": { height: 15, padX: 9, gapX: 0, radius: FULL, font: 9, weight: 700, tracking: 1.5 },
  "#score": { padX: 10, gapX: 6, radius: 12, font: 9.5, weight: 700, tracking: 2 },
  "#panel": { padX: 10, padY: 10, gapX: 6, radius: 12, font: 15, weight: 700, tracking: 0.3, width: 280 },
  "#n-reject": { minHeight: FULL, padX: 12, padY: 5, gapX: 7, radius: 12, font: 11, weight: 600, tracking: 0.5, leading: 1.25, maxWidth: 260, lines: 2, sentence: true },
  "#n-toast": { ...EXTRA_PILL, maxWidth: 420 },
  "#n-waiting": EXTRA_PILL,
  "#n-empty": EXTRA_PILL,
} as const;
export type NoticeSelector = keyof typeof MOCKUP;

/** The HUD combination pill's box before plan 5, in points at scale 1, until its task moves it to the mockup. */
const TABLE_CHIP = { padX: 11, gapX: 7, font: 9, tracking: 1.5, strongTracking: 0.6 } as const;

const MOCKUP_STAGE_H = 402;
const RISE = 6;
const DOT = 6;

type Spec<S extends NoticeShape> = {
  shape: S;
  selector: NoticeSelector;
  tones: readonly ToneOf<S>[];
  tableChip?: true;
  keepsEmber?: true;
};
export type NoticeSpec = { [S in NoticeShape]: Spec<S> }[NoticeShape];

export const NOTICES = {
  hudCombo: { shape: "pill", selector: ".chip", tones: ["neutral"], tableChip: true },
  turn: { shape: "pill", selector: "#turn", tones: ["neutral", "lit", "urgent"], keepsEmber: true },
  whoStarts: { shape: "panel", selector: "#panel", tones: ["neutral"] },
  passed: { shape: "chip", selector: ".passo", tones: ["neutral"] },
  reconnecting: { shape: "chip", selector: ".passo", tones: ["neutral"] },
  vacated: { shape: "chip", selector: ".passo", tones: ["neutral"] },
  combo: { shape: "chip", selector: ".cchip", tones: ["lit"] },
  roundWinner: { shape: "chip", selector: ".cchip", tones: ["lit"] },
  pileLabel: { shape: "chip", selector: ".cchip", tones: ["lit"] },
  passFloat: { shape: "float", selector: ".floatchip", tones: ["neutral"] },
  rejectFloat: { shape: "float", selector: "#n-reject", tones: ["bad"] },
  errorToast: { shape: "float", selector: "#n-toast", tones: ["bad"] },
  waitingOthers: { shape: "pill", selector: "#n-waiting", tones: ["gold"] },
  emptyHand: { shape: "pill", selector: "#n-empty", tones: ["gold"] },
} as const satisfies Record<string, NoticeSpec>;
export type NoticeKind = keyof typeof NOTICES;
export type KindTone<K extends NoticeKind> = (typeof NOTICES)[K]["tones"][number];

const at = (px: number, scale: number) => (px / cardScale(MOCKUP_STAGE_H)) * scale;
export const mockupPx = at;

export type NoticeBox = {
  height: number | undefined;
  minHeight: number | undefined;
  width: number | undefined;
  maxWidth: number | undefined;
  lines: number;
  upper: boolean;
  lineHeight: number | undefined;
  padX: number;
  padY: number;
  gap: number;
  radius: number;
  fontSize: number;
  strongFontSize: number;
  bold: boolean;
  tracking: number;
  strongTracking: number;
  dot: number;
};

export function selectorBox(selector: NoticeSelector, scale: number): NoticeBox {
  const px = MOCKUP[selector];
  const tall = (h: number | typeof FULL) => (h === FULL ? CHIP_H(scale) : at(h, scale));
  const fontSize = tableFontSize(at(px.font, 1), scale);
  return {
    height: "height" in px ? tall(px.height) : undefined,
    minHeight: "minHeight" in px ? tall(px.minHeight) : undefined,
    width: "width" in px ? at(px.width, scale) : undefined,
    maxWidth: "maxWidth" in px ? at(px.maxWidth, scale) : undefined,
    lines: "lines" in px ? px.lines : 1,
    upper: !("sentence" in px),
    lineHeight: "leading" in px ? fontSize * px.leading : undefined,
    padX: at(px.padX, scale),
    padY: "padY" in px ? at(px.padY, scale) : 0,
    gap: at(px.gapX, scale),
    radius: px.radius === FULL ? Radius.full : at(px.radius, scale),
    fontSize,
    strongFontSize: tableFontSize(at("strongFont" in px ? px.strongFont : px.font, 1), scale),
    bold: px.weight === 700,
    tracking: at(px.tracking, scale),
    strongTracking: at(px.tracking, scale),
    dot: at(DOT, scale),
  };
}

export function noticeBox(kind: NoticeKind, scale: number): NoticeBox {
  const spec: NoticeSpec = NOTICES[kind];
  const box = selectorBox(spec.selector, scale);
  if (!spec.tableChip) return box;
  return {
    ...box,
    padX: TABLE_CHIP.padX * scale,
    gap: TABLE_CHIP.gapX * scale,
    fontSize: tableFontSize(TABLE_CHIP.font, scale),
    strongFontSize: tableFontSize(TABLE_CHIP.font, scale),
    tracking: TABLE_CHIP.tracking * scale,
    strongTracking: TABLE_CHIP.strongTracking * scale,
  };
}

const MARK_AT = { top: { x: -60, y: -8 }, side: { x: 0, y: 27 } } as const;

/** `.seat[data-side] .passo`: the mark's centre x and top edge, off the disc's centre. */
export function markAt(side: keyof typeof MARK_AT, scale: number): { x: number; y: number } {
  return { x: at(MARK_AT[side].x, scale), y: at(MARK_AT[side].y, scale) };
}

const FLOAT_TOP = 300;

/** `.floatchip`'s top edge, up from the foot of the stage. */
export function floatAboveFoot(scale: number): number {
  return at(MOCKUP_STAGE_H - FLOAT_TOP, scale);
}

const PANEL_LINES = {
  main: { font: 15, weight: 700, tracking: 0.3 },
  sub: { font: 11, weight: 600, tracking: 0.4 },
  hint: { font: 10, weight: 600, tracking: 1.5 },
} as const;
export type PanelLine = keyof typeof PANEL_LINES;

export function panelLine(line: PanelLine, scale: number): { fontSize: number; tracking: number; bold: boolean } {
  const px = PANEL_LINES[line];
  return { fontSize: tableFontSize(at(px.font, 1), scale), tracking: at(px.tracking, scale), bold: px.weight === 700 };
}

const PANEL_PARTS = { rowX: 7.5, subY: 2, tileW: 22, tileH: 30, tileRadius: 3, tileLip: 1.5, tileFont: 13, tileSuit: 11, disc: 24, discFont: 10 } as const;

export function panelParts(scale: number) {
  const p = PANEL_PARTS;
  return {
    rowGap: at(p.rowX, scale),
    subGap: at(p.subY, scale),
    tile: { width: at(p.tileW, scale), height: at(p.tileH, scale), radius: at(p.tileRadius, scale) },
    tileLip: at(p.tileLip, scale),
    tileFont: tableFontSize(at(p.tileFont, 1), scale),
    tileSuit: at(p.tileSuit, scale),
    disc: at(p.disc, scale),
    discFont: tableFontSize(at(p.discFont, 1), scale),
  };
}

type Glow = { plate: number; dot: number };
const GLOW: Partial<Record<NoticeSelector, Partial<Record<NoticeTone, Glow>>>> = {
  "#turn": { lit: { plate: 20.6, dot: DOT }, urgent: { plate: 18, dot: DOT } },
};
/** #1265's ember, in points at scale 1: plan 5 changes no ember value, so it stands over `#turn.urgent`'s. */
const EMBER: Glow = { plate: 18, dot: 9 };

export function selectorGlow(selector: NoticeSelector, tone: NoticeTone, scale: number): Glow {
  const px = GLOW[selector]?.[tone];
  return px ? { plate: at(px.plate, scale), dot: at(px.dot, scale) } : { plate: 0, dot: 0 };
}

export function noticeGlow(kind: NoticeKind, tone: NoticeTone, scale: number): Glow {
  const spec: NoticeSpec = NOTICES[kind];
  if (spec.keepsEmber && tone === "urgent") return { plate: EMBER.plate * scale, dot: EMBER.dot * scale };
  return selectorGlow(spec.selector, tone, scale);
}

export function noticeRise(scale: number, reduceMotion: boolean): number {
  return reduceMotion ? 0 : at(RISE, scale);
}

export function noticeTiming(
  shape: NoticeShape,
  reduceMotion: boolean,
): { enter: number; hold: number | null; exit: number } {
  const { enter, hold, exit } = Motion.mark;
  if (shape === "chip" || shape === "float") return { enter, hold, exit };
  const ms = motionMs("notice", reduceMotion);
  return { enter: ms, hold: null, exit: ms };
}
