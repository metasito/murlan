// Every rect on the table, in window points: the places `tableLayout` decides and the table's views
// are set from, filled with what a state puts in them. What the property test and the browser spec
// hold the rendered table to; it adds no place or number of its own.
//
// JSX-free, runtime imports relative — docs/agents/checks.md, "Node's TypeScript loader".

import { BACK_SCALE, CARD_H, CARD_W, FIELD_SCALE, handCardSize } from "./cardFaceModel.ts";
import { pileSlots } from "./flightPose.ts";
import { fanCorners, fanPoint, seatLabelRise } from "./fanGeometry.ts";
import { layoutHandRow } from "./handLayout.ts";
import { CHIP_H, SEAT_DISC, SEAT_LABEL_ALIGN, SEAT_NAME_LINE, seatAnchor, seatLabelLeft, seatBadgeSlot, seatLabelW, seatNameRise, seatNameSet } from "./seatLayout.ts";
import type { OpponentSide } from "./seatLayout.ts";
import { aligned, type Align } from "./flexAlign.ts";
import { faceWordsWidth, noticeWidth, widestDigits, type NoticeContent, type NoticeLocale, type Pricing } from "./table/noticeWidth.ts";
import { seatBadgeH } from "./table/noticeModel.ts";
import { scorePillBox } from "./table/scorePillModel.ts";
import type { EdgeInsets } from "./tableFrame.ts";
import { tableLayout, type Rect, type TableLayout } from "./tableLayout.ts";

export type { Rect };

export const RECT_NAMES = [
  "window",
  "rail",
  "railMenu",
  "railFoot",
  "hudCombo",
  "hudTurn",
  "pileNote",
  "scorePill",
  "seatTop",
  "seatLeft",
  "seatRight",
  "nameTop",
  "nameLeft",
  "nameRight",
  "badgeTop",
  "badgeLeft",
  "badgeRight",
  "fanTop",
  "fanLeft",
  "fanRight",
  "pile",
  "handZone",
  "passa",
  "gioca",
  "hand",
] as const;
export type RectName = (typeof RECT_NAMES)[number];

export interface TableState {
  /** Who sits each side and the cards they hold, 0 once they have gone out; null for a side no one sits. */
  seats: Record<OpponentSide, { name: string; cards: number; badge?: SeatBadgeState } | null>;
  hand: { cards: number; onTurn: boolean; faceDown: boolean };
  /** Cards in the combination on top of the pile; 0 on an empty table. */
  pile: number;
  chips: { combo: NoticeContent; turn: NoticeContent; /** The exchange's note under the pile, while it has one. */ note?: NoticeContent };
}

/** The badge under a seat's name: its player has left, or is reconnecting with `seconds` of grace shown. */
export type SeatBadgeState = { kind: "vacated" } | { kind: "reconnecting"; seconds: number };

/** One card as drawn: its four corners, in order round the card. */
export type Card = readonly (readonly [number, number])[];

export interface TableRects {
  layout: TableLayout;
  rects: Record<RectName, Rect | null>;
  /** The cards inside a fan's or the pile's rect, which are what may not touch: the rect's corners beside a turned card are bare felt. */
  cards: Partial<Record<RectName, readonly Card[]>>;
  /** How far past the window a rect is drawn on purpose: the hand's crop and tilt. */
  bleed: Partial<Record<RectName, { bottom: number }>>;
  /** Where a rect sized by priced words holds the words drawn in it, which may run narrower than the price. */
  aligns: Partial<Record<RectName, Align>>;
  /** How much wider than its words, as they read now, at linear advances such a rect is priced: what snapping each glyph to a pixel may add, and a counted run's headroom up to its widest digits. */
  overcount: Partial<Record<RectName, number>>;
  /** A rect the table holds to its room, narrower than its words need. */
  capped: Partial<Record<RectName, boolean>>;
  /** A rect whose words must stay whole and are drawn cut at its room: a pill of catalogue words alone, which a name or a clock does not bound. */
  cut: Partial<Record<RectName, boolean>>;
}

/** The turn chip is saying the exchange's instruction, which is no use cut: a name or a clock may be, a sentence of the catalogue may not. */
const isExchangeWords = (turn: NoticeContent) =>
  turn.some((part) => "runs" in part && part.runs.some((r) => r.run.startsWith("text:exchange.")));

const box = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });
const centred = (cx: number, cy: number, w: number, h: number): Rect => box(cx - w / 2, cy - h / 2, w, h);

/** A `w`×`h` card turned `rot` degrees about its centre. */
function turned(cx: number, cy: number, w: number, h: number, rot: number): Card {
  const r = (rot * Math.PI) / 180;
  const [c, s] = [Math.cos(r), Math.sin(r)];
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => [cx + (sx * w * c - sy * h * s) / 2, cy + (sx * w * s + sy * h * c) / 2] as const);
}

function cover(card: Card): Rect {
  const xs = card.map((p) => p[0]);
  const ys = card.map((p) => p[1]);
  return box(Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
}

function span(rects: readonly Rect[]): Rect | null {
  if (rects.length === 0) return null;
  const x0 = Math.min(...rects.map((r) => r.x));
  const y0 = Math.min(...rects.map((r) => r.y));
  return box(x0, y0, Math.max(...rects.map((r) => r.x + r.w)) - x0, Math.max(...rects.map((r) => r.y + r.h)) - y0);
}

export function tableRects(input: {
  width: number;
  height: number;
  insets: EdgeInsets;
  locale: NoticeLocale;
  state: TableState;
}): TableRects {
  const { width, height, insets, locale, state } = input;
  const layout = tableLayout({ width, height, insets });
  const { scale, frame, anchors, chips, rail, handZone, buttons } = layout;

  const comboRoom = layout.chipRow({ combo: 0, turn: 0 }).combo.room;
  const comboShown = state.chips.combo.length > 0;
  const comboW = comboShown ? noticeWidth("hudCombo", locale, chips, state.chips.combo, "snapped", comboRoom) : 0;
  const turnRoom = layout.chipRow({ combo: comboW, turn: 0 }).turn.room;
  const turnW = noticeWidth("turn", locale, chips, state.chips.turn, "snapped", turnRoom);
  const hud = layout.chipRow({ combo: comboW, turn: turnW });
  const overcount: TableRects["overcount"] = {
    hudCombo: comboShown ? comboW - noticeWidth("hudCombo", locale, chips, state.chips.combo, "linear", comboRoom) : 0,
    hudTurn: turnW - noticeWidth("turn", locale, chips, state.chips.turn, "linear", turnRoom),
  };
  const turnCentred = layout.pill.centreX - turnW / 2;
  const turnAlign: Align = Math.abs(hud.turn.left - turnCentred) < EPS ? "center" : hud.turn.left > turnCentred ? "flex-start" : "flex-end";
  const capped: TableRects["capped"] = {
    hudCombo: comboShown && noticeWidth("hudCombo", locale, chips, state.chips.combo) > comboRoom + EPS,
    hudTurn: noticeWidth("turn", locale, chips, state.chips.turn) > turnRoom + EPS,
  };
  const note = state.chips.note;
  const noteRoom = layout.pileNote.room;
  const noteW = note ? noticeWidth("pileNote", locale, scale, note, "snapped", noteRoom) : 0;
  if (note) {
    overcount.pileNote = noteW - noticeWidth("pileNote", locale, scale, note, "linear", noteRoom);
    capped.pileNote = noticeWidth("pileNote", locale, scale, note) > noteRoom + EPS;
  }
  const whole = (content: NoticeContent) => content.every((part) => "runs" in part);
  const cut: TableRects["cut"] = {
    hudCombo: comboShown && whole(state.chips.combo) && capped.hudCombo,
    pileNote: note !== undefined && whole(note) && capped.pileNote,
    hudTurn: isExchangeWords(state.chips.turn) && capped.hudTurn,
  };
  const pill = scorePillBox(0, 0, layout.pill);
  const chipH = CHIP_H(chips);

  const ring = SEAT_DISC * scale;
  const seat = (dir: OpponentSide) => centred(anchors[dir].x, anchors[dir].y, ring, ring);
  const fan = (dir: OpponentSide): Card[] => {
    const count = state.seats[dir]?.cards ?? 0;
    if (count === 0) return [];
    const at = fanPoint(layout.seatPoint(dir), dir, scale, count);
    return fanCorners({ x: anchors.pile.x + at.x, y: anchors.pile.y + at.y }, dir, count, scale * BACK_SCALE);
  };
  const fans = { top: fan("top"), left: fan("left"), right: fan("right") };
  const { face, ...nameSet } = seatNameSet(scale);
  const rise = (dir: OpponentSide) => seatLabelRise(dir, scale);
  const named = (dir: OpponentSide, as: RectName): Rect | null => {
    const who = state.seats[dir];
    if (!who) return null;
    const anchor = seatAnchor(dir);
    const labelW = seatLabelW(anchor, scale);
    const priced = (pricing: Pricing) => faceWordsWidth(face, nameSet, locale, who.name, pricing);
    const w = Math.min(priced("snapped"), labelW);
    overcount[as] = w - Math.min(priced("linear"), labelW);
    capped[as] = priced("snapped") > labelW + EPS;
    const bottom = anchors[dir].y - ring / 2 - seatNameRise(dir, scale, seatBadgeH(who.badge?.kind, scale), rise(dir));
    const labelLeft = anchors[dir].x - ring / 2 + seatLabelLeft(anchor, scale, layout.nameInset[dir]);
    return box(aligned(SEAT_LABEL_ALIGN[anchor], labelLeft, labelW, w), bottom - SEAT_NAME_LINE * scale, w, SEAT_NAME_LINE * scale);
  };
  const badged = (dir: OpponentSide, as: RectName): Rect | null => {
    const who = state.seats[dir];
    if (!who?.badge) return null;
    const { kind } = who.badge;
    const counted = (words: string): NoticeContent =>
      kind === "vacated"
        ? [{ runs: [{ run: "text:game.seatLeft", slots: [who.name] }] }]
        : [{ runs: [{ run: "text:gameTable.seatReconnecting", slots: [words] }] }];
    const shown = who.badge.kind === "reconnecting" ? String(who.badge.seconds) : "";
    const h = seatBadgeH(kind, scale);
    const slot = seatBadgeSlot(dir, scale, layout.nameInset[dir], h, rise(dir), layout.badgeRoom[dir]);
    const widest = counted(widestDigits(kind, scale, shown.length));
    const w = noticeWidth(kind, locale, scale, widest, "snapped", slot.width);
    overcount[as] = w - noticeWidth(kind, locale, scale, counted(shown), "linear", slot.width);
    if (noticeWidth(kind, locale, scale, widest) > slot.width + EPS) capped[as] = true;
    const slotLeft = anchors[dir].x - ring / 2 + slot.left;
    return box(aligned(slot.align, slotLeft, slot.width, w), anchors[dir].y - ring / 2 + slot.top, w, h);
  };

  const fieldW = CARD_W(scale * FIELD_SCALE);
  const fieldH = CARD_H(scale * FIELD_SCALE);
  const pileCards = pileSlots(state.pile, fieldW, frame.fieldRoomW, fieldH).map((at) => turned(anchors.pile.x + at.x, anchors.pile.y + at.y, fieldW, fieldH, at.rot));

  const size = handCardSize(scale, state.hand.onTurn, state.hand.faceDown);
  const row = layoutHandRow({
    ids: Array.from({ length: state.hand.cards }, (_, i) => String(i)),
    size,
    roomW: frame.handRoomW,
    availW: frame.handAvailW,
    bottomPad: frame.bottomPad,
  });
  const rowLeft = anchors.bottom.x - row.width / 2;
  const rowTop = anchors.bottom.y + row.base - row.visibleH;
  let hand: Rect | null = null;
  if (row.cards.length > 0) {
    const drawn = span(row.cards.map((c) => cover(turned(rowLeft + c.left + c.shift + size.w / 2, rowTop + row.visibleH - c.bottom - size.h / 2, size.w, size.h, c.rot))))!;
    if (row.scrollable) {
      const x0 = Math.max(drawn.x, anchors.bottom.x - frame.handAvailW / 2);
      const y0 = Math.max(drawn.y, rowTop - row.topClearance);
      const x1 = Math.min(drawn.x + drawn.w, anchors.bottom.x + frame.handAvailW / 2);
      const y1 = Math.min(drawn.y + drawn.h, rowTop + row.visibleH + row.crop + row.tiltOverhang);
      hand = box(x0, y0, x1 - x0, y1 - y0);
    } else hand = drawn;
  }

  return {
    layout,
    rects: {
      window: box(0, 0, width, height),
      rail: box(0, 0, rail.width, height),
      railMenu: rail.menu,
      railFoot: rail.foot,
      hudCombo: comboShown ? box(hud.combo.left, hud.combo.top, comboW, chipH) : null,
      hudTurn: box(hud.turn.left, hud.turn.top, turnW, chipH),
      pileNote: note ? box(layout.pileNote.centreX - noteW / 2, layout.pileNote.top, noteW, layout.pileNote.h) : null,
      scorePill: box(pill.x, pill.y, pill.w, pill.h),
      seatTop: state.seats.top && seat("top"),
      seatLeft: state.seats.left && seat("left"),
      seatRight: state.seats.right && seat("right"),
      nameTop: named("top", "nameTop"),
      nameLeft: named("left", "nameLeft"),
      nameRight: named("right", "nameRight"),
      badgeTop: badged("top", "badgeTop"),
      badgeLeft: badged("left", "badgeLeft"),
      badgeRight: badged("right", "badgeRight"),
      fanTop: span(fans.top.map(cover)),
      fanLeft: span(fans.left.map(cover)),
      fanRight: span(fans.right.map(cover)),
      pile: span(pileCards.map(cover)),
      handZone: handZone,
      passa: buttons.passa,
      gioca: buttons.gioca,
      hand,
    },
    cards: { fanTop: fans.top, fanLeft: fans.left, fanRight: fans.right, pile: pileCards },
    bleed: { hand: { bottom: row.crop + row.tiltOverhang } },
    aligns: {
      hudCombo: "flex-start",
      hudTurn: turnAlign,
      pileNote: "center",
      nameTop: SEAT_LABEL_ALIGN[seatAnchor("top")],
      nameLeft: SEAT_LABEL_ALIGN[seatAnchor("left")],
      nameRight: SEAT_LABEL_ALIGN[seatAnchor("right")],
      badgeTop: seatBadgeSlot("top", scale, layout.nameInset.top, 0, 0, Infinity).align,
      badgeLeft: seatBadgeSlot("left", scale, layout.nameInset.left, 0, 0, Infinity).align,
      badgeRight: seatBadgeSlot("right", scale, layout.nameInset.right, 0, 0, Infinity).align,
    },
    overcount,
    capped,
    cut,
  };
}

type Pair = readonly [RectName, RectName];

const SOLID: readonly RectName[] = [
  "railMenu",
  "railFoot",
  "hudCombo",
  "hudTurn",
  "pileNote",
  "scorePill",
  "seatTop",
  "seatLeft",
  "seatRight",
  "nameTop",
  "nameLeft",
  "nameRight",
  "badgeTop",
  "badgeLeft",
  "badgeRight",
  "fanTop",
  "fanLeft",
  "fanRight",
  "pile",
  "passa",
  "gioca",
  "hand",
];

const pairs = (names: readonly RectName[]): Pair[] =>
  names.flatMap((a, i) => names.slice(i + 1).map((b): Pair => [a, b]));

/**
 * What must hold on every table. Everything solid keeps clear of everything else solid, the rail
 * keeps clear of all but its own knobs, and the hand zone only contains. A seat's ring and its own
 * fan are one stack, so they are not paired.
 */
export const TABLE_RULES: { inside: readonly RectName[]; apart: readonly Pair[] } = {
  inside: RECT_NAMES.filter((name) => name !== "window"),
  apart: [
    ...pairs(SOLID).filter(([a, b]) => ![["seatTop", "fanTop"], ["seatLeft", "fanLeft"], ["seatRight", "fanRight"]].some(([x, y]) => x === a && y === b)),
    ...SOLID.filter((name) => name !== "railMenu" && name !== "railFoot").map((name): Pair => ["rail", name]),
  ],
};

/** Float noise, far under a device pixel; neither side of a rule is moved by it. */
const EPS = 1e-6;

export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w - EPS && b.x < a.x + a.w - EPS && a.y < b.y + b.h - EPS && b.y < a.y + a.h - EPS;
}

/** Two convex cards touch unless an edge of one has the other wholly on its far side. */
export function cardsTouch(a: Card, b: Card): boolean {
  for (const poly of [a, b])
    for (let i = 0; i < poly.length; i++) {
      const [x0, y0] = poly[i];
      const [x1, y1] = poly[(i + 1) % poly.length];
      const along = ([x, y]: readonly [number, number]) => (x - x0) * (y1 - y0) - (y - y0) * (x1 - x0);
      const [sa, sb] = [a.map(along), b.map(along)];
      if (Math.max(...sa) <= Math.min(...sb) + EPS || Math.max(...sb) <= Math.min(...sa) + EPS) return false;
    }
  return true;
}

const asCard = (r: Rect): Card => turned(r.x + r.w / 2, r.y + r.h / 2, r.w, r.h, 0);

/** The rules a table breaks, each in words; empty when it keeps them all. */
export function brokenRules(table: Pick<TableRects, "rects" | "bleed"> & Partial<Pick<TableRects, "cards" | "cut">>): string[] {
  const { rects, bleed, cards = {}, cut = {} } = table;
  const out: string[] = [];
  const win = rects.window!;
  for (const name of TABLE_RULES.inside) {
    const r = rects[name];
    if (!r) continue;
    const slack = bleed[name]?.bottom ?? 0;
    if (![r.x, r.y, r.w, r.h].every(Number.isFinite) || r.w <= 0 || r.h <= 0) out.push(`${name} is not a rect`);
    else if (r.x < win.x - EPS || r.y < win.y - EPS || r.x + r.w > win.x + win.w + EPS || r.y + r.h > win.y + win.h + slack + EPS) {
      out.push(`${name} leaves the window`);
    }
  }
  for (const name of Object.keys(cut) as RectName[]) if (cut[name]) out.push(`${name} cuts its words`);
  for (const [a, b] of TABLE_RULES.apart) {
    const [ra, rb] = [rects[a], rects[b]];
    if (!ra || !rb || !intersects(ra, rb)) continue;
    const [ca, cb] = [cards[a] ?? [asCard(ra)], cards[b] ?? [asCard(rb)]];
    if (ca.some((x) => cb.some((y) => cardsTouch(x, y)))) out.push(`${a} overlaps ${b}`);
  }
  return out;
}
