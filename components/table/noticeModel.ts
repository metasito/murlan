// JSX-free, runtime imports relative — docs/agents/checks.md, "Node's TypeScript loader".
import { Motion, motionMs, Radius, type NoticePalette } from "../../lib/tokens.ts";
import { cardScale, tableFontSize } from "../cardFaceModel.ts";
import { CHIP_H } from "../seatLayout.ts";

export type NoticeShape = "pill" | "chip" | "float" | "panel";
export type NoticeTone = "neutral" | "lit" | "urgent" | "ok" | "bad";
export type ToneOf<S extends NoticeShape> = keyof (typeof NoticePalette)[S] & NoticeTone;

const FULL = "full";
const CHIP = { height: FULL, padX: 12, gapX: 6, radius: FULL, font: 10, weight: 600, tracking: 1.55 } as const;

const MOCKUP = {
  ".chip": CHIP,
  "#turn": { ...CHIP, padX: 13, gapX: 7 },
  ".floatchip": CHIP,
  ".passo": { height: 15, padX: 7, gapX: 0, radius: 8, font: 8, weight: 700, tracking: 1.28 },
  ".cchip": { height: 15, padX: 9, gapX: 0, radius: FULL, font: 9, weight: 700, tracking: 1.5 },
  "#score": { padX: 10, gapX: 6, radius: 12, font: 9.5, weight: 700, tracking: 2 },
  "#panel": { padX: 10, padY: 10, gapX: 6, radius: 12, font: 15, weight: 700, tracking: 0.3, width: 280 },
} as const;
export type NoticeSelector = keyof typeof MOCKUP;

/** Today's `TableChip`, in points at scale 1: a pill keeps it until its task moves it to the mockup. */
const TABLE_CHIP = { padX: 11, gapX: 7, font: 9, tracking: 1.5, strongTracking: 0.6 } as const;

const MOCKUP_STAGE_H = 402;
const RISE = 6;

type Spec<S extends NoticeShape> = {
  shape: S;
  selector: NoticeSelector;
  tones: readonly ToneOf<S>[];
  tableChip?: true;
};
export type NoticeSpec = { [S in NoticeShape]: Spec<S> }[NoticeShape];

export const NOTICES = {
  hudCombo: { shape: "pill", selector: ".chip", tones: ["neutral"], tableChip: true },
  whoStarts: { shape: "panel", selector: "#panel", tones: ["neutral"] },
} as const satisfies Record<string, NoticeSpec>;
export type NoticeKind = keyof typeof NOTICES;
export type KindTone<K extends NoticeKind> = (typeof NOTICES)[K]["tones"][number];

const at = (px: number, scale: number) => (px / cardScale(MOCKUP_STAGE_H)) * scale;
export const mockupPx = at;

export type NoticeBox = {
  height: number | undefined;
  width: number | undefined;
  padX: number;
  padY: number;
  gap: number;
  radius: number;
  fontSize: number;
  bold: boolean;
  tracking: number;
  strongTracking: number;
};

export function selectorBox(selector: NoticeSelector, scale: number): NoticeBox {
  const px = MOCKUP[selector];
  const height = !("height" in px) ? undefined : px.height === FULL ? CHIP_H(scale) : at(px.height, scale);
  return {
    height,
    width: "width" in px ? at(px.width, scale) : undefined,
    padX: at(px.padX, scale),
    padY: "padY" in px ? at(px.padY, scale) : 0,
    gap: at(px.gapX, scale),
    radius: px.radius === FULL ? Radius.full : at(px.radius, scale),
    fontSize: tableFontSize(at(px.font, 1), scale),
    bold: px.weight === 700,
    tracking: at(px.tracking, scale),
    strongTracking: at(px.tracking, scale),
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
    tracking: TABLE_CHIP.tracking * scale,
    strongTracking: TABLE_CHIP.strongTracking * scale,
  };
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

const GLOW = { lit: 20.6, urgent: 18 } as const;

export function noticeGlow(tone: NoticeTone, scale: number): number {
  return tone in GLOW ? at(GLOW[tone as keyof typeof GLOW], scale) : 0;
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
