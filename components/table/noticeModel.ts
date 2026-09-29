// JSX-free, runtime imports relative — docs/agents/checks.md, "Node's TypeScript loader".
import { Motion, motionMs, Radius, type NoticePalette } from "../../lib/tokens.ts";
import { cardScale, tableFontSize } from "../cardFaceModel.ts";
import { CHIP_H } from "../seatLayout.ts";

export type NoticeShape = "pill" | "chip" | "float" | "panel";
export type NoticeTone = "neutral" | "lit" | "urgent" | "ok" | "bad";
export type ToneOf<S extends NoticeShape> = keyof (typeof NoticePalette)[S] & NoticeTone;

const FULL = "full";
const CHIP = { height: FULL, padX: 12, gapX: 6, radius: FULL, font: 10, tracking: 1.55 } as const;

const MOCKUP = {
  ".chip": CHIP,
  "#turn": { ...CHIP, padX: 13, gapX: 7 },
  ".floatchip": CHIP,
  ".passo": { height: 15, padX: 7, gapX: 0, radius: 8, font: 8, tracking: 1.28 },
  ".cchip": { height: 15, padX: 9, gapX: 0, radius: FULL, font: 9, tracking: 1.5 },
  "#score": { padX: 10, gapX: 6, radius: 12, font: 9.5, tracking: 2 },
} as const;
export type NoticeSelector = keyof typeof MOCKUP;

const MOCKUP_STAGE_H = 402;
const RISE = 6;
// `.chip b` tracks at the chip's 1.55; the HUD pill keeps its 0.6 so its box stays where the bands put it.
const STRONG_TRACKING = 0.6;

type Spec<S extends NoticeShape> = { shape: S; selector: NoticeSelector; tones: readonly ToneOf<S>[] };
export type NoticeSpec = { [S in NoticeShape]: Spec<S> }[NoticeShape];

export const NOTICES = {
  hudCombo: { shape: "pill", selector: ".chip", tones: ["neutral"] },} as const satisfies Record<string, NoticeSpec>;
export type NoticeKind = keyof typeof NOTICES;
export type KindTone<K extends NoticeKind> = (typeof NOTICES)[K]["tones"][number];

const at = (px: number, scale: number) => (px / cardScale(MOCKUP_STAGE_H)) * scale;

export type NoticeBox = {
  height: number | undefined;
  padX: number;
  gap: number;
  radius: number;
  fontSize: number;
  tracking: number;
  strongTracking: number;
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
    tracking: at(px.tracking, scale),
    strongTracking: px === CHIP ? STRONG_TRACKING * scale : at(px.tracking, scale),
  };
}

export function noticeBox(kind: NoticeKind, scale: number): NoticeBox {
  return selectorBox(NOTICES[kind].selector, scale);
}

const GLOW = { lit: 20.6, urgent: 18 } as const;

export function noticeGlow(tone: NoticeTone, scale: number): number {
  return tone in GLOW ? at(GLOW[tone as keyof typeof GLOW], scale) : 0;
}

export function noticeRise(scale: number, reduceMotion: boolean): number {
  return reduceMotion ? 0 : at(RISE, scale);
}

export function noticeTiming(shape: NoticeShape, reduceMotion: boolean): { enter: number; exit: number } {
  if (shape === "chip" || shape === "float") return { enter: Motion.mark.enter, exit: Motion.mark.exit };
  const ms = motionMs("notice", reduceMotion);
  return { enter: ms, exit: ms };
}
