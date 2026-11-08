// JSX-free, runtime imports relative — docs/agents/checks.md, "Node's TypeScript loader".
import { Hold, Motion, motionMs, Radius, type NoticePalette } from "../../lib/tokens.ts";
import { cardScale, tableFontSize } from "../cardFaceModel.ts";
import { CHIP_H } from "../seatLayout.ts";
import { USERNAME_MAX } from "../../shared/username.ts";
import { CLOCK_CEILING_MS, clockDigits } from "../../shared/clock.ts";
import { SEATS_MAX } from "../../shared/seats.ts";
import { createDeck, getCardDisplayRank } from "../../lib/game/gameEngine.ts";

export type NoticeShape = "pill" | "chip" | "float" | "panel";
export type NoticeTone = "neutral" | "lit" | "urgent" | "ok" | "bad" | "solid" | "gold";
type ToneOf<S extends NoticeShape> = keyof (typeof NoticePalette)[S] & NoticeTone;

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
  "#n-offline": EXTRA_PILL,
  "#n-reject": { minHeight: FULL, padX: 12, padY: 5, gapX: 7, radius: 12, font: 11, weight: 600, tracking: 0.5, leading: 1.25, maxWidth: 260, lines: 2, sentence: true },
  "#n-toast": { ...EXTRA_PILL, maxWidth: 420 },
  "#n-waiting": EXTRA_PILL,
  "#n-empty": EXTRA_PILL,
  "#n-vote": EXTRA_PILL,
} as const;
export type NoticeSelector = keyof typeof MOCKUP;

/** The HUD combination pill's box before plan 5, in points at scale 1, until its task moves it to the mockup. */
const TABLE_CHIP = { padX: 11, gapX: 7, font: 9, tracking: 1.5, strongTracking: 0.6 } as const;

/** The turn pill's Riprova key, `#turn u` in the mockup's px. */
export const NOTICE_KEY = { padX: 7, padY: 3, radius: 8, tracking: 1 } as const;

export const MOCKUP_STAGE_H = 402;
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
  hudCombo: { shape: "pill", selector: ".chip", tones: ["neutral", "lit"], tableChip: true },
  turn: { shape: "pill", selector: "#turn", tones: ["neutral", "lit", "urgent", "ok", "bad"], keepsEmber: true },
  offline: { shape: "pill", selector: "#n-offline", tones: ["solid"] },
  whoStarts: { shape: "panel", selector: "#panel", tones: ["neutral"] },
  leftTable: { shape: "panel", selector: "#panel", tones: ["neutral"] },
  passed: { shape: "chip", selector: ".passo", tones: ["neutral"] },
  reconnecting: { shape: "chip", selector: ".passo", tones: ["neutral"] },
  vacated: { shape: "chip", selector: ".passo", tones: ["neutral"] },
  trickWinner: { shape: "chip", selector: ".cchip", tones: ["lit"] },
  passFloat: { shape: "float", selector: ".floatchip", tones: ["neutral"] },
  rejectFloat: { shape: "float", selector: "#n-reject", tones: ["bad"] },
  errorToast: { shape: "float", selector: "#n-toast", tones: ["bad"] },
  waitingOthers: { shape: "pill", selector: "#n-waiting", tones: ["gold"] },
  emptyHand: { shape: "pill", selector: "#n-empty", tones: ["gold"] },
  endMatchVote: { shape: "pill", selector: "#n-vote", tones: ["neutral", "lit"] },
  roundVote: { shape: "pill", selector: "#n-vote", tones: ["neutral", "lit"] },
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
  runtime: Partial<Record<NoticeRole, RuntimeBound>>;
};

/** What bounds a run whose words only render time knows: its length, or the width it is clipped to on the run itself or on the plate. */
export type RuntimeBound = { chars: number } | { maxWidth: number; lines: number; on: "run" | "plate" };
type RuntimePx = { chars: number } | { runMaxWidth: number } | "plate";

/** The HUD combination pill's name run, in points at scale 1, so a long username ellipsizes rather than pushing the band wider than the felt has room for. */
const HUD_NAME_MAX_W = 88;
const CLOCK_CHARS = clockDigits(CLOCK_CEILING_MS);
/** Only a suited card draws a tile. */
const RANK_CHARS = Math.max(...createDeck().filter((card) => card.suit !== null).map((card) => getCardDisplayRank(card.rank).length));
const TALLY_CHARS = `${SEATS_MAX}/${SEATS_MAX}`.length;

const RUNTIME: { [K in NoticeKind]?: Partial<Record<NoticeRole, RuntimePx>> } = {
  hudCombo: { text: { runMaxWidth: HUD_NAME_MAX_W } },
  turn: { strong: { chars: CLOCK_CHARS } },
  whoStarts: { name: { chars: USERNAME_MAX }, initial: { chars: 1 }, tile: { chars: RANK_CHARS } },
  trickWinner: { text: { chars: USERNAME_MAX } },
  rejectFloat: { text: "plate" },
  errorToast: { text: "plate" },
  roundVote: { badge: { chars: TALLY_CHARS } },
  endMatchVote: { badge: { chars: TALLY_CHARS } },
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
    runtime: {},
  };
}

export function noticeBox(kind: NoticeKind, scale: number): NoticeBox {
  const box = onTableChip(NOTICES[kind], selectorBox(NOTICES[kind].selector, scale), scale);
  const runtime: NoticeBox["runtime"] = {};
  for (const [role, bound] of Object.entries(RUNTIME[kind] ?? {}) as [NoticeRole, RuntimePx][]) {
    if (bound !== "plate") runtime[role] = "chars" in bound ? bound : { maxWidth: bound.runMaxWidth * scale, lines: box.lines, on: "run" };
    else if (box.maxWidth === undefined) throw new Error(`${kind} bounds its ${role} run by a plate with no maxWidth`);
    else runtime[role] = { maxWidth: box.maxWidth, lines: box.lines, on: "plate" };
  }
  return { ...box, runtime };
}

function onTableChip(spec: NoticeSpec, box: NoticeBox, scale: number): NoticeBox {
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

export const NOTICE_FACES = {
  regular: { fontFamily: "Rajdhani_600SemiBold" },
  bold: { fontFamily: "Rajdhani_700Bold" },
} as const;

export type NoticeRun = { face: keyof typeof NOTICE_FACES; upper: boolean; tabular: boolean };

/** What a notice sets in a run of words: `NoticeText`'s plain and counted runs, `NoticeKey`, `NoticeDisc`'s word and initial, `NoticeName`, `NoticeTile`'s rank, `NoticeBadge` and `NoticeLine`'s three. */
export type NoticeRole = "text" | "strong" | "key" | "disc" | "initial" | "name" | "tile" | "badge" | PanelLine;

export function noticeRun(box: NoticeBox, role: NoticeRole): NoticeRun {
  if (role === "text" || role === "strong") {
    return { face: role === "strong" || box.bold ? "bold" : "regular", upper: box.upper, tabular: role === "strong" };
  }
  if (role === "key" || role === "initial") return { face: "bold", upper: true, tabular: false };
  if (role === "disc" || role === "name" || role === "tile") return { face: "bold", upper: false, tabular: false };
  if (role === "badge") return { face: "bold", upper: false, tabular: true };
  return { face: PANEL_LINES[role].weight === 700 ? "bold" : "regular", upper: role === "hint", tabular: false };
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

export function panelLine(line: PanelLine, scale: number): { fontSize: number; tracking: number } {
  const px = PANEL_LINES[line];
  return { fontSize: tableFontSize(at(px.font, 1), scale), tracking: at(px.tracking, scale) };
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
  "#n-vote": { lit: { plate: 20.6, dot: 0 } },
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

const BLINK_DIM = 0.25;

export function noticeBlink(reduceMotion: boolean): { half: number; dim: number } | null {
  return reduceMotion ? null : { half: Motion.mark.blink / 2, dim: BLINK_DIM };
}

export function noticeTiming(
  shape: NoticeShape,
  reduceMotion: boolean,
): { enter: number; hold: number | null; exit: number } {
  const fade: { enter: number; exit: number } = (reduceMotion ? Motion.reduced.mark : null) ?? Motion.mark;
  if (shape === "chip" || shape === "float") return { enter: fade.enter, hold: Hold.mark, exit: fade.exit };
  const ms = motionMs("notice", reduceMotion);
  return { enter: ms, hold: null, exit: ms };
}
