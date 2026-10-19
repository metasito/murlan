// tests/ui-rules/handRowPin.test.ts — the hand row as it was laid out before the layout had one
// owner, on every phone, for the biggest hand each seat count deals.
//
// tests/fixtures/handRow.json was written from StraightHand's own arithmetic (#1653); the row
// computed here must land on it.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  cardScale,
  CARD_W,
  CARD_H,
  CARD_BACK_W,
  CARD_BACK_H,
  HAND_NEAR_RATIO,
  HAND_SCALE,
  HAND_SCALE_ON_TURN,
} from "../../components/cardFaceModel.ts";
import { computeTableFrame } from "../../components/tableFrame.ts";
import { computeHandLayout, hitWidth, slotForCard } from "../../components/handLayout.ts";
import { HAND_ARC, solveArc } from "../../components/tableArc.ts";
import { HAND_CROP, HAND_ZONE_H, exchangeArrivalRise, handRowHeadroom } from "../../components/seatLayout.ts";
import { PHONES } from "../e2e/helpers/phones.ts";
import { dealCards } from "../../lib/game/gameEngine.ts";

const SELECT_TILT = -3;
const HELD_SCALE = 1.06;
const PILE = { dx: 37, dy: -110 };

interface Case {
  phone: string;
  seats: number;
  n: number;
  onTurn: boolean;
  faceDown: boolean;
  arriving?: number;
  held?: number;
}

function cases(): Case[] {
  const out: Case[] = [];
  for (const phone of PHONES) {
    for (const seats of [2, 3, 4]) {
      const n = Math.max(...dealCards(seats).hands.map((h) => h.length));
      for (const onTurn of [false, true]) {
        out.push({ phone: phone.name, seats, n, onTurn, faceDown: false });
        if (!onTurn) out.push({ phone: phone.name, seats, n, onTurn, faceDown: true });
        out.push({ phone: phone.name, seats, n, onTurn, faceDown: false, arriving: Math.floor(n / 2) });
        out.push({ phone: phone.name, seats, n, onTurn, faceDown: false, held: 2 });
      }
    }
  }
  return out;
}

function frameOf(name: string) {
  const phone = PHONES.find((p) => p.name === name)!;
  const scale = cardScale(Math.min(phone.width, phone.height));
  const frame = computeTableFrame({
    width: phone.width,
    height: phone.height,
    insets: { top: 0, bottom: 0, left: 0, right: 0 },
    scale,
  });
  return { scale, frame };
}

function row(c: Case) {
  const { scale, frame } = frameOf(c.phone);
  const n = c.n;
  const parting = c.held === undefined ? c.arriving : undefined;
  const slotCount = parting === undefined ? n : n + 1;
  const cs = scale * (c.onTurn ? HAND_SCALE_ON_TURN : HAND_SCALE);
  const room = c.onTurn ? frame.handRoomW * HAND_NEAR_RATIO : frame.handRoomW;
  const cardW = c.faceDown ? CARD_BACK_W(cs) : CARD_W(cs);
  const cardH = c.faceDown ? CARD_BACK_H(cs) : CARD_H(cs);
  const crop = cardH * HAND_CROP;
  const visibleH = cardH - crop;
  const availW = frame.handAvailW;
  const bottomPad = frame.bottomPad;
  const { step, totalW, scrollable } = computeHandLayout(slotCount, room, cardW, availW);
  const rowW = Math.min(totalW, availW);
  const overhang = Math.max(0, totalW - availW);
  const solve = (count: number) => solveArc(count, { budget: HAND_ARC, cardW, cardH, scale: cs, room: totalW, step });
  const full = solve(slotCount);
  const arcRise = full.box.h - cardH;
  const arrivalRise = exchangeArrivalRise(CARD_H(scale * HAND_SCALE), bottomPad, arcRise / 2);
  const maxRot = full.cards.reduce((m, at) => Math.max(m, Math.abs(at.rot)), 0);
  const tiltRad = ((maxRot + Math.abs(SELECT_TILT)) * Math.PI) / 180;
  const tiltOverhang = (cardW * Math.sin(tiltRad) + cardH * Math.cos(tiltRad) - cardH) / 2;
  const fanRise = arcRise + handRowHeadroom(cardH);
  const topClearance = fanRise + tiltOverhang;
  const heldCeiling = crop - fanRise + (cardH * (HELD_SCALE - 1)) / 2;
  const ids = Array.from({ length: n }, (_, i) => i);
  const rest = c.held === undefined ? ids : ids.filter((i) => i !== c.held);
  const arc = c.held === undefined ? full.cards : solve(rest.length).cards;
  const rowMid = (scrollable ? totalW : rowW) / 2;
  const closed = parting === undefined ? full : solve(n);
  const zoneH = HAND_ZONE_H(CARD_H(scale * HAND_SCALE), bottomPad);
  const rowCentreY = zoneH / 2 - bottomPad - (visibleH + arcRise) / 2;
  const rowBase = rowCentreY + visibleH / 2;
  const cards = rest.map((j, i) => {
    const slot = slotForCard(i, parting);
    const at = arc[slot] ?? arc[arc.length - 1];
    const home = closed.cards[j] ?? at;
    return {
      left: rowMid + home.x,
      bottom: -crop - home.y,
      rot: home.rot,
      shift: at.x - home.x,
      restX: home.x + cardW / 2,
      restY: rowBase + crop + home.y - cardH / 2,
      hitW: hitWidth(slot, arc.length, step, cardW),
      stripTop: visibleH + crop + home.y - cardH,
      dealFromX: -home.x + PILE.dx,
      dealRise: cardH / 2 - crop - home.y - arrivalRise + PILE.dy,
    };
  });
  return {
    cardScale: cs,
    cardW,
    cardH,
    step,
    totalW,
    scrollable,
    width: scrollable ? totalW : rowW,
    panLimit: overhang / 2,
    visibleH,
    crop,
    arcRise,
    tiltOverhang,
    topClearance,
    heldCeiling,
    rowCentreY,
    rowBase,
    cards,
    slots: full.cards.map((at) => ({ x: rowMid + at.x, y: crop + at.y, rot: at.rot })),
  };
}


const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PIN = JSON.parse(readFileSync(path.join(repoRoot, "tests/fixtures/handRow.json"), "utf8")) as {
  case: Case;
  row: unknown;
}[];

const TOLERANCE = 1e-6;

function near(actual: unknown, pinned: unknown, at: string): void {
  if (typeof pinned === "number") {
    assert.equal(typeof actual, "number", `${at} is not a number`);
    assert.ok(Math.abs((actual as number) - pinned) <= TOLERANCE, `${at}: ${String(actual)}, pinned ${pinned}`);
    return;
  }
  if (pinned !== null && typeof pinned === "object") {
    assert.ok(actual !== null && typeof actual === "object", `${at} is missing`);
    const a = actual as Record<string, unknown>;
    const p = pinned as Record<string, unknown>;
    assert.deepEqual(Object.keys(a).sort(), Object.keys(p).sort(), `${at} has other fields`);
    for (const k of Object.keys(p)) near(a[k], p[k], `${at}.${k}`);
    return;
  }
  assert.equal(actual, pinned, at);
}

describe("the hand row lands where it was pinned", () => {
  test("the pin covers every case, and nothing else", () => {
    assert.deepEqual(
      PIN.map((p) => p.case),
      cases()
    );
    assert.ok(PIN.length >= PHONES.length * 3 * 7);
  });

  for (const { case: c, row: pinned } of PIN) {
    const name = `${c.phone}, ${c.seats} seats, ${c.onTurn ? "on" : "off"} turn${c.faceDown ? ", backs" : ""}${
      c.arriving !== undefined ? `, arriving at ${c.arriving}` : ""
    }${c.held !== undefined ? `, holding ${c.held}` : ""}`;
    test(name, () => near(row(c), pinned, "row"));
  }
});
