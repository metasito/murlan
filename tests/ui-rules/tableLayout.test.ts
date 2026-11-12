// Where the table puts its seats, its pile, its float and its box, from one window and safe area.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { BACK_SCALE, CARD_H, FIELD_SCALE, HAND_SCALE, handCardSize } from "../../components/cardFaceModel.ts";
import { layoutHandRow } from "../../components/handLayout.ts";
import { PHONES } from "../e2e/helpers/phones.ts";
import { drawnFanBounds, fanPoint, seatFanArc } from "../../components/fanGeometry.ts";
import type { CardFrom } from "../../components/flightPose.ts";
import { FAN_CARD_SCALE } from "../../components/impact.ts";
import {
  arrangeOpponents,
  CHIP_H,
  drawnDisc,
  FAN_DRAWN_CARDS,
  HAND_ZONE_GAP,
  HAND_ZONE_H,
  handVisibleH,
  SEAT_DISC,
  seatGap,
  seatLabelH,
  type FlyDirection,
} from "../../components/seatLayout.ts";
import { readExchangeLegs } from "../../components/table/exchangeModel.ts";
import { readThrownPlay } from "../../components/table/throws.ts";
import { sideSlotHeight, topBandHeight } from "../../components/tableFrame.ts";
import { ownSlotFrom, PILE_MIN_H, tableLayout, type Delta, type TableLayout } from "../../components/tableLayout.ts";
import type { Card, Combination, Player } from "../../lib/game/gameEngine.ts";
import { clientSources, scanSources } from "../helpers/sourceScan.ts";
import { INSETS, phoneTable } from "../helpers/phoneTable.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const scan = (pattern: RegExp) => scanSources(pattern, clientSources(repoRoot));

const NO_INSETS = { top: 0, bottom: 0, left: 0, right: 0 };
const DIRS = ["top", "bottom", "left", "right"] as const;

describe("anchors", () => {
  // The rail makes the left and right pads differ, so a test that happens to pass only because the
  // table is centred cannot hide here.
  const at = (scale = 1) => tableLayout({ width: 800 * scale, height: 390 * scale, insets: NO_INSETS });
  const base = at();
  const midTop = (l: TableLayout) => l.frame.tableTop + topBandHeight(l.scale);
  const pileY = (l: TableLayout) => midTop(l) + (l.window.height - l.frame.surplus - midTop(l) - l.handZoneH) / 2;

  test("the frame under these numbers: the rail on the left, the away pad on the right", () => {
    assert.deepEqual([base.frame.tableLeft, base.frame.tableRight, base.frame.tableTop, base.frame.surplus], [58, 58, 13, 0]);
  });

  test("bottom: the throw starts at the hand row's own vertical centre", () => {
    assert.deepEqual(base.seatPoint("bottom"), { dx: 0, dy: 390 - base.handZoneH / 2 - pileY(base) });
  });

  test("bottom: the pile's own centre, not a fixed constant, is what scale moves through", () => {
    const two = at(2);
    assert.ok(midTop(two) > midTop(base), "a larger scale takes a taller top band");
    assert.equal(two.seatPoint("bottom").dy, two.anchors.bottom.y - pileY(two));
  });

  test("top: dx is 0 — the top seat and the pile share the same horizontal centre", () => {
    assert.equal(base.seatPoint("top").dx, 0);
  });

  test("top: the throw starts above the pile, at the ring's own line", () => {
    // seatLabelH(1) = 17 + gap 2 + pad 4 + CHIP_H(1)=23 = 46; ringCenterY = 13+46+33/2 = 75.5.
    assert.equal(base.seatPoint("top").dy, 75.5 - pileY(base));
  });

  test("the top band is the label, the ring, the gap and the fan at its drawn cap", () => {
    const fanH = seatFanArc(FAN_DRAWN_CARDS.top, BACK_SCALE).bounds.h;
    assert.equal(topBandHeight(1), seatLabelH(1) + SEAT_DISC + seatGap(1) + fanH);
  });

  test("left/right: the side ring centres in its fixed slot at the top of the band", () => {
    const fanW = seatFanArc(FAN_DRAWN_CARDS.left, BACK_SCALE).bounds.w;
    assert.equal(sideSlotHeight(1), Math.max(SEAT_DISC, fanW));
    const dy = midTop(base) + sideSlotHeight(1) / 2 - pileY(base);
    assert.ok(dy < 0, `a raised seat throws downward into the pile: ${dy}`);
    assert.equal(base.seatPoint("left").dy, dy);
    assert.equal(base.seatPoint("right").dy, dy);
  });

  test("the bands hold every fan they draw", () => {
    for (const scale of [0.6, 1, 1.4, 2.1]) {
      const backScale = scale * BACK_SCALE;
      const fixedTop = topBandHeight(scale) - seatLabelH(scale) - SEAT_DISC * scale - seatGap(scale);
      assert.ok(Math.abs(fixedTop - drawnFanBounds(scale).topH) < 1e-9, `scale ${scale}: the top band is not the cap's`);
      for (let n = 1; n <= FAN_DRAWN_CARDS.top; n++) {
        const h = seatFanArc(n, backScale).bounds.h;
        assert.ok(h <= fixedTop + 1e-9, `scale ${scale}: ${n} top backs stand ${h} in a band of ${fixedTop}`);
      }
      for (const side of ["left", "right"] as const) {
        for (let n = 1; n <= FAN_DRAWN_CARDS[side]; n++) {
          const w = seatFanArc(n, backScale).bounds.w;
          assert.ok(w <= sideSlotHeight(scale) + 1e-9, `scale ${scale}: ${n} ${side} backs span ${w} in a slot of ${sideSlotHeight(scale)}`);
        }
      }
    }
  });

  test("the hand zone is taken from the hand card, and each seat's point from the anchors", () => {
    assert.equal(base.handCardH, CARD_H(HAND_SCALE));
    assert.equal(base.handZoneH, HAND_ZONE_H(base.handCardH, base.frame.bottomPad));
    for (const dir of DIRS) {
      const a = base.anchors;
      assert.deepEqual(base.seatPoint(dir), { dx: a[dir].x - a.pile.x, dy: a[dir].y - a.pile.y }, dir);
    }
  });

  test("the anchors are window points", () => {
    const a = base.anchors;
    // tableW = 800-58-58 = 684, so the pile and the top ring sit on the window's centre line, x = 58+342 = 400.
    assert.deepEqual(a.bottom, { x: 400, y: 390 - base.handZoneH / 2 });
    assert.deepEqual(a.top, { x: 400, y: 75.5 });
    assert.deepEqual(a.pile, { x: 400, y: pileY(base) });
    assert.deepEqual(a.left, { x: 82.5, y: midTop(base) + sideSlotHeight(1) / 2 });
    assert.deepEqual(a.right, { x: 717.5, y: a.left.y });
  });

  test("left: the throw starts at the ring flush against the rail", () => {
    // ringCenterX = 58 + Spacing.sm(8) + SEAT_DISC/2(16.5) = 82.5; dx = 82.5 - 400.
    assert.equal(base.seatPoint("left").dx, -317.5);
  });

  test("right: the throw starts at the ring flush against the opposite edge", () => {
    assert.equal(base.seatPoint("right").dx, 317.5);
  });

  test("left and right are mirror images of the same pile centre, and the table's centre line is the window's", () => {
    assert.equal(base.seatPoint("left").dx + base.seatPoint("right").dx, 0);
  });

  test("the sweep heads for the round winner's seat", () => {
    assert.notDeepEqual(base.seatPoint("left"), base.seatPoint("top"));
  });

  test("SEAT_DISC and FAN_DRAWN_CARDS.top are the numbers a throw's origin is measured against", () => {
    // Pinned so a change to either is a deliberate edit here too, not a
    // silent drift between the seat's own rendering and the throw's origin.
    assert.equal(SEAT_DISC, 33);
    assert.equal(FAN_DRAWN_CARDS.top, 7);
  });

  // A copy of SEAT_DISC also holds the pinned value above, so that assertion
  // alone can never see one — only the source scan can (same reasoning as the
  // CARD_W/CARD_H scan in `tests/ui-rules/layoutConstantsPinned.test.ts`).
  test("SEAT_DISC is declared in seatLayout.ts and nowhere else", () => {
    const SEAT_DISC_DECL = /(?<![\w$])(?:const|let|var)\s+SEAT_DISC(?![\w$])/g;
    assert.deepEqual(scan(SEAT_DISC_DECL), ["components/seatLayout.ts: const SEAT_DISC"]);
  });
});

const VIEWPORTS = [
  [568, 320],
  [844, 390],
  [956, 440],
  [1112, 834],
  [1366, 1024],
] as const;

describe("the table's box and its chip row", () => {
  for (const [width, height] of VIEWPORTS) {
    for (const [name, insets] of Object.entries(INSETS)) {
      test(`${width}×${height} at ${name}`, () => {
        const l = phoneTable(width, height, insets);
        assert.equal(l.tableBox.bottom, l.frame.surplus);
        assert.deepEqual(
          [l.tableBox.left, l.tableBox.top, l.tableBox.right],
          [l.frame.tableLeft, l.frame.tableTop, l.frame.tableRight]
        );
        assert.equal(l.chipsBottom, l.frame.tableTop + CHIP_H(l.scale) + l.frame.pad);
      });
    }
  }
});

test("the float slot is the mockup's .floatchip on its own stage: centred on the table, its top at 300", () => {
  const l = phoneTable(874, 402);
  assert.ok(Math.abs(l.anchors.pile.x - 437) <= 0.5);
  assert.ok(Math.abs(l.floatTop - 300) <= 0.5, `y ${l.floatTop}`);
});

test("the float clears the resting hand by the same gap whatever the safe area", () => {
  for (const [width, height] of [[874, 402], [568, 320], [932, 430]]) {
    const gaps = Object.entries(INSETS).map(([name, insets]) => {
      const l = phoneTable(width, height, insets);
      const cardTop = height - l.frame.surplus - l.frame.bottomPad - handVisibleH(l.handCardH);
      return { name, gap: cardTop - (l.floatTop + CHIP_H(l.scale)) };
    });
    for (const { name, gap } of gaps) {
      assert.ok(gap > 0, `${width}×${height} at ${name}: the float overlaps the hand by ${-gap}`);
      assert.ok(Math.abs(gap - gaps[0].gap) < 1e-9, `${width}×${height} at ${name}: gap ${gap} against ${gaps[0].gap}`);
    }
  }
});

describe("ownSlotFrom", () => {
  const origin = { dx: 12, dy: 140 };

  test("a card the hand drew starts at its own slot, moved from the hand's centre to the pile's", () => {
    assert.deepEqual(ownSlotFrom(origin, { x: -40, y: -6, rot: 4, scale: 1.1 }), { x: -28, y: 134, rot: 4, scale: 1.1 });
  });

  test("a card the hand never drew starts at the seat's point, upright, at the hand's size", () => {
    assert.deepEqual(ownSlotFrom(origin, undefined), { x: 12, y: 140, rot: 0, scale: HAND_SCALE / FIELD_SCALE });
  });
});

// `layout.anchors` is the only anchors computation: what a throw or an exchange leg starts from is a
// seat's point, at a fan or through `ownSlotFrom`. A layout whose points no real table has proves it.
describe("throws and exchange legs start from the layout's seat points", () => {
  const real = phoneTable(844, 390);
  const POINTS: Record<FlyDirection, Delta> = {
    top: { dx: 3, dy: -101 },
    bottom: { dx: 5, dy: 107 },
    left: { dx: -211, dy: -13 },
    right: { dx: 223, dy: -17 },
  };
  const odd: TableLayout = { ...real, seatPoint: (dir) => POINTS[dir] };
  const card = (id: string) => ({ id, suit: "clubs", rank: "5", isJoker: false }) as Card;
  const seat = (id: string, n: number) =>
    ({ id, name: id, type: "bot", hand: Array.from({ length: n }, (_, i) => card(`${id}_${i}`)) }) as unknown as Player;
  const players = [seat("me", 5), seat("right", 6), seat("top", 7), seat("left", 8)];
  const seating = { viewerSeat: 0, players, opponents: arrangeOpponents(players, 0) };
  const own = new Map<string, CardFrom>([["x", { x: -40, y: -6, rot: 4, scale: 1.1 }]]);
  const fanFrom = (dir: "top" | "left" | "right", seatIdx: number) => ({
    ...fanPoint(POINTS[dir], dir, odd.scale, players[seatIdx].hand.length),
    scale: FAN_CARD_SCALE,
  });

  test("a throw", () => {
    const pair = { type: "pair", cards: [card("x"), card("y")], strength: 5 } as Combination;
    const mine = readThrownPlay({ combo: pair, playedBy: 0 }, odd, seating, own);
    assert.deepEqual(mine.from, [ownSlotFrom(POINTS.bottom, own.get("x")), ownSlotFrom(POINTS.bottom, undefined)]);
    for (const [seatIdx, dir] of [[1, "right"], [2, "top"], [3, "left"]] as const) {
      assert.deepEqual(readThrownPlay({ combo: pair, playedBy: seatIdx }, odd, seating).from, [fanFrom(dir, seatIdx), fanFrom(dir, seatIdx)], dir);
    }
  });

  test("an exchange", () => {
    const announced = { winnerName: "", loserName: "", winnerIdx: 0, loserIdx: 2, twoJokers: false, oneWay: false, cardReceived: card("t"), cardGiven: card("x") };
    const legs = readExchangeLegs(announced, odd, seating, own);
    assert.deepEqual(legs.receive.from, fanFrom("top", 2));
    assert.deepEqual(legs.receive.to, ownSlotFrom(POINTS.bottom, undefined));
    assert.deepEqual(legs.give.from, ownSlotFrom(POINTS.bottom, own.get("x")));
    assert.deepEqual(legs.give.to, fanFrom("top", 2));
  });

  test("the pile a throw lands on is the layout's", () => {
    const pair = { type: "pair", cards: [card("x")], strength: 5 } as Combination;
    assert.equal(readThrownPlay({ combo: pair, playedBy: 2 }, odd, seating).pile, real.anchors.pile);
  });
});

describe("the middle band, the hand zone and the hand window", () => {
  const near = (a: number, b: number, what: string) => assert.ok(Math.abs(a - b) < 1e-9, `${what}: ${a} vs ${b}`);
  const tables = PHONES.flatMap((p) => Object.entries(INSETS).map(([inset, insets]) => ({ what: `${p.name} ${inset}`, l: phoneTable(p.width, p.height, insets) })));

  test("the hand window sits between the buttons, a scaled gap from each", () => {
    for (const { what, l } of tables) {
      const { handWindow: w, buttons } = l;
      near(w.x - (buttons.passa.x + buttons.passa.w), HAND_ZONE_GAP * l.scale, `${what} passa`);
      near(buttons.gioca.x - (w.x + w.w), HAND_ZONE_GAP * l.scale, `${what} gioca`);
      near(w.y, l.handZone.y, `${what} top`);
      near(w.h, l.handZone.h - l.frame.bottomPad, `${what} height`);
    }
  });

  test("play on the left swaps PASSA and GIOCA, and the refused play's float with GIOCA, and nothing else", () => {
    for (const p of PHONES) {
      for (const [inset, insets] of Object.entries(INSETS)) {
        const what = `${p.name} ${inset}`;
        const right = tableLayout({ width: p.width, height: p.height, insets });
        const left = tableLayout({ width: p.width, height: p.height, insets, playOnLeft: true });
        assert.deepEqual(left.buttons, { passa: right.buttons.gioca, gioca: right.buttons.passa }, `${what} buttons`);
        assert.deepEqual([left.placed.passa, left.placed.gioca], [right.placed.gioca, right.placed.passa], `${what} placed`);
        assert.ok(left.buttons.gioca.x < left.handWindow.x && left.buttons.passa.x > left.handWindow.x + left.handWindow.w, `${what}: GIOCA on the left of the row`);
        assert.deepEqual([right.floatBeside.mirrored, left.floatBeside.mirrored], [false, true], `${what} float`);
        const rest = (l: TableLayout) => {
          const { buttons: _b, placed: { passa: _p, gioca: _g, ...placed }, floatBeside: { mirrored: _m, ...beside }, seatPoint: _s, chipRow: _c, ...more } = l;
          return { placed, beside, more };
        };
        assert.deepEqual(rest(left), rest(right), `${what}: the rest of the table stays put`);
      }
    }
  });

  test("the middle band spans the table from the top band down to the hand zone", () => {
    for (const { what, l } of tables) {
      near(l.midBand.y, l.frame.tableTop + topBandHeight(l.scale), `${what} top`);
      near(l.midBand.y + l.midBand.h, l.handZone.y, `${what} foot`);
      assert.deepEqual([l.midBand.x, l.midBand.w], [l.handZone.x, l.handZone.w], what);
    }
  });

  test("the top band runs from the table's top to the middle band, and its seat's ring centres in it", () => {
    for (const { what, l } of tables) {
      near(l.topBand.y, l.frame.tableTop, `${what} top`);
      near(l.topBand.y + l.topBand.h, l.midBand.y, `${what} foot`);
      assert.deepEqual([l.topBand.x, l.topBand.w], [l.midBand.x, l.midBand.w], what);
      near(l.anchors.top.x, l.topBand.x + l.topBand.w / 2, `${what} ring`);
    }
  });

  test("each side seat's ring stands against its slot's outer side, centred down it; the pile centres between the slots", () => {
    for (const { what, l } of tables) {
      const ring = drawnDisc(l.scale) / 2;
      const { left, right } = l.seatSlots;
      near(left.y, l.midBand.y, `${what} left top`);
      near(right.y, l.midBand.y, `${what} right top`);
      near(l.anchors.left.y, left.y + left.h / 2, `${what} left centred`);
      near(l.anchors.right.y, right.y + right.h / 2, `${what} right centred`);
      near(l.anchors.left.x - left.x, ring, `${what} left against its side`);
      near(right.x + right.w - l.anchors.right.x, ring, `${what} right against its side`);
      near(left.x - l.midBand.x, l.midBand.x + l.midBand.w - (right.x + right.w), `${what} gaps mirror`);
      assert.ok(left.x > l.midBand.x && left.x + left.w < l.pileBand.x, `${what}: the left slot sits inside its column`);
      assert.ok(right.x > l.pileBand.x + l.pileBand.w && right.x + right.w < l.midBand.x + l.midBand.w, `${what}: the right slot sits inside its column`);
      near(l.pileBand.x + l.pileBand.w / 2, l.anchors.pile.x, `${what} pile x`);
      near(l.pileBand.y + l.pileBand.h / 2, l.anchors.pile.y, `${what} pile y`);
      near(l.pileBand.h, l.midBand.h, `${what} pile band height`);
      assert.deepEqual([l.pile.x, l.pile.w, l.pile.h], [l.pileBand.x, l.pileBand.w, PILE_MIN_H], `${what}: the pile is the band's width at its least height`);
      near(l.pile.y + l.pile.h / 2, l.anchors.pile.y, `${what} pile centred`);
      assert.ok(l.pile.y + l.pile.h < l.handZone.y, `${what}: the pile's box stops short of the hand zone`);
    }
  });

  test("each placed box lands on its rect, spanning its parent or at its own size against one edge", () => {
    const sided = PHONES.flatMap((p) => Object.entries(INSETS).flatMap(([inset, insets]) => [false, true].map((playOnLeft) => ({
      what: `${p.name} ${inset}${playOnLeft ? " play on the left" : ""}`,
      l: tableLayout({ width: p.width, height: p.height, insets, playOnLeft }),
    }))));
    for (const { what, l } of sided) {
      const table = { x: l.tableBox.left, y: l.tableBox.top, w: l.window.width - l.tableBox.left - l.tableBox.right, h: l.window.height - l.tableBox.top - l.tableBox.bottom };
      const cases = [
        ["topBand", table, l.topBand],
        ["midBand", table, l.midBand],
        ["seatLeft", l.midBand, l.seatSlots.left],
        ["seatRight", l.midBand, l.seatSlots.right],
        ["pile", l.midBand, l.pile],
        ["handZone", table, l.handZone],
        ["handWindow", l.handZone, l.handWindow],
        ["passa", l.handZone, l.buttons.passa],
        ["gioca", l.handZone, l.buttons.gioca],
      ] as const;
      assert.deepEqual(cases.map(([key]) => key).sort(), Object.keys(l.placed).sort(), `${what}: every placed box is checked`);
      for (const [key, outer, inner] of cases) {
        const p: Partial<Record<"left" | "right" | "width" | "top" | "bottom" | "height", number>> = l.placed[key];
        assert.equal(Object.keys(p).length, 4, `${what} ${key}: two lengths per axis`);
        const x = p.left ?? outer.w - p.right! - p.width!;
        const y = p.top ?? outer.h - p.bottom! - p.height!;
        near(outer.x + x, inner.x, `${what} ${key} left`);
        near(outer.y + y, inner.y, `${what} ${key} top`);
        near(p.width ?? outer.w - x - p.right!, inner.w, `${what} ${key} width`);
        near(p.height ?? outer.h - y - p.bottom!, inner.h, `${what} ${key} height`);
      }
      const pins = Object.fromEntries(Object.entries(l.placed).map(([key, p]) => [key, Object.keys(p).sort().join(" ")]));
      const [passaSide, giocaSide] = l.floatBeside.mirrored ? ["right", "left"] : ["left", "right"];
      assert.ok(l.floatBeside.mirrored === l.buttons.gioca.x < l.buttons.passa.x, `${what}: GIOCA on the side it is placed against`);
      const pile: Partial<Record<"top" | "height", number>> = l.placed.pile;
      near(pile.top!, l.anchors.pile.y - PILE_MIN_H / 2 - l.midBand.y, `${what}: the pile's top, from the middle band's, centres it on the anchor`);
      near(pile.height!, PILE_MIN_H, `${what}: the pile's height`);
      assert.deepEqual(pins, {
        topBand: "height left right top",
        midBand: "bottom left right top",
        seatLeft: "height left top width",
        seatRight: "height right top width",
        pile: "height left right top",
        handZone: "bottom left right top",
        handWindow: "bottom left right top",
        passa: `bottom height ${passaSide} width`,
        gioca: `bottom height ${giocaSide} width`,
      }, `${what}: a box of its own size stands against the edge it is drawn at`);
    }
  });

  test("the hand row rests centred in the window, or at one end of its pan when it scrolls", () => {
    let scrolled = 0;
    for (const { what, l } of tables) {
      for (const n of [5, 27]) {
        const row = layoutHandRow({ ids: Array.from({ length: n }, (_, i) => `c${i}`), size: handCardSize(l.scale, false, false), roomW: l.frame.handRoomW, availW: l.handWindow.w, bottomPad: l.frame.bottomPad });
        const rest = l.handWindow.w / 2 + row.left;
        if (row.scrollable) {
          scrolled++;
          near(rest, -row.panLimit, `${what} ${n} scrolled`);
        } else near(rest + row.width / 2, l.handWindow.w / 2, `${what} ${n} centred`);
      }
    }
    assert.ok(scrolled > 0, "some table scrolls its widest hand");
  });
});
