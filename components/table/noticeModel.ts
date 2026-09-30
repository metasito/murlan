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
  "#turn": { ...CHIP, padX: 130, gapX: 7, strongFont: 12 },
  ".floatchip": CHIP,
  ".passo": { height: 15, padX: 7, gapX: 0, radius: 8, font: 8, weight: 700, tracking: 1.28 },
  ".cchip": { height: 15, padX: 9, gapX: 0, radius: FULL, font: 9, weight: 700, tracking: 1.5 },
  "#score": { padX: 10, gapX: 6, radius: 12, font: 9.5, weight: 700, tracking: 2 },
} as const;
export type NoticeSelector = keyof typeof MOCKUP;

/** Today's `TableChip`, in points at scale 1: a pill keeps it until its task moves it to the mockup. */
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
} as const satisfies Record<string, NoticeSpec>;
export type NoticeKind = keyof typeof NOTICES;
export type KindTone<K extends NoticeKind> = (typeof NOTICES)[K]["tones"][number];

const at = (px: number, scale: number) => (px / cardScale(MOCKUP_STAGE_H)) * scale;

export type NoticeBox = {
  height: number | undefined;
  padX: number;
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
  const height = !("height" in px) ? undefined : px.height === FULL ? CHIP_H(scale) : at(px.height, scale);
  return {
    height,
    padX: at(px.padX, scale),
    gap: at(px.gapX, scale),
    radius: px.radius === FULL ? Radius.full : at(px.radius, scale),
    fontSize: tableFontSize(at(px.font, 1), scale),
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
