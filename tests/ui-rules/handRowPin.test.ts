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
import { cardScale, handCardSize } from "../../components/cardFaceModel.ts";
import { computeTableFrame } from "../../components/tableFrame.ts";
import { entryOffset, layoutHandRow } from "../../components/handLayout.ts";
import { PHONES } from "../e2e/helpers/phones.ts";
import { dealCards } from "../../lib/game/gameEngine.ts";

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
  const ids = Array.from({ length: c.n }, (_, i) => `c${i}`);
  const r = layoutHandRow({
    ids,
    arriving: c.arriving,
    held: c.held === undefined ? null : ids[c.held],
    size: handCardSize(scale, c.onTurn, c.faceDown),
    roomW: frame.handRoomW,
    availW: frame.handAvailW,
    bottomPad: frame.bottomPad,
  });
  return {
    cardScale: r.size.scale,
    cardW: r.size.w,
    cardH: r.size.h,
    step: r.step,
    totalW: r.totalW,
    scrollable: r.scrollable,
    width: r.width,
    panLimit: r.panLimit,
    visibleH: r.visibleH,
    crop: r.crop,
    arcRise: r.arcRise,
    tiltOverhang: r.tiltOverhang,
    topClearance: r.topClearance,
    heldCeiling: r.heldCeiling,
    rowCentreY: r.base - r.visibleH / 2,
    rowBase: r.base,
    cards: r.cards.map((p, i) => {
      const dealt = entryOffset(r, p, PILE);
      const { left, bottom, rot, shift, restX, restY, hitW } = p;
      return { left, bottom, rot, shift, restX, restY, hitW, stripTop: r.strips.tops[i], dealFromX: dealt.dx, dealRise: dealt.dy };
    }),
    slots: r.slots,
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
