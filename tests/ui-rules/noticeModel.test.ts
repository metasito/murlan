// The mockup's numbers are written here as literals, read off
// tests/e2e/fixtures/lantern-table/index.html by selector, never back from the module.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Colors, NoticePalette } from "../../lib/tokens.ts";
import { CHIP_H } from "../../components/seatLayout.ts";
import { NOTICES, noticeBlink, noticeBox, noticeGlow, noticeRise, noticeTiming, panelLine, selectorBox, selectorGlow, type NoticeKind } from "../../components/table/noticeModel.ts";

const STAGE = 402 / 390;
const at = (px: number, scale: number) => (px / STAGE) * scale;
const SCALES = [0.82, 1, 402 / 390, 1.13, 2];
const near = (actual: number, expected: number, what: string) =>
  assert.ok(Math.abs(actual - expected) < 0.05, `${what}: ${actual} is not the mockup's ${expected}`);

// Today's TableChip (components/table/chrome.tsx on main): 11/7 pt, FontSize.xxs, .15em/.06em.
test("the HUD combination pill keeps today's box at every scale, 412- and 430-pt phones included", () => {
  for (const s of [...SCALES, 1.07]) {
    const box = noticeBox("hudCombo", s);
    assert.equal(box.height, CHIP_H(s), "the HUD bands are laid out against CHIP_H");
    near(box.height ?? NaN, at(23.7, s), `.chip height at ${s}`);
    near(box.padX, 11 * s, `padding at ${s}`);
    near(box.gap, 7 * s, `gap at ${s}`);
    near(box.fontSize, Math.max(9 * s, 10), `type at ${s}`);
    near(box.tracking, 1.5 * s, `tracking at ${s}`);
    near(box.strongTracking, 0.6 * s, `strong tracking at ${s}`);
    assert.equal(box.bold, false);
  }
  assert.equal(noticeBox("hudCombo", 1.07).fontSize, 10);
});

test("every selector's box is the mockup's", () => {
  const MOCKUP = {
    ".chip": { height: 23.7, padX: 12, gap: 6, font: 10, tracking: 1.55, bold: false },
    "#turn": { height: 23.7, padX: 13, gap: 7, font: 10, strongFont: 12, tracking: 1.55, bold: false },
    ".floatchip": { height: 23.7, padX: 12, gap: 6, font: 10, tracking: 1.55, bold: false },
    ".passo": { height: 15, padX: 7, gap: 0, font: 8, tracking: 1.28, radius: 8, bold: true },
    ".cchip": { height: 15, padX: 9, gap: 0, font: 9, tracking: 1.5, bold: true },
    "#score": { padX: 10, gap: 6, font: 9.5, tracking: 2, radius: 12, bold: true },
  } as const;
  for (const s of SCALES) {
    for (const [selector, px] of Object.entries(MOCKUP)) {
      const box = selectorBox(selector as keyof typeof MOCKUP, s);
      if ("height" in px) near(box.height ?? NaN, at(px.height, s), `${selector} height at ${s}`);
      else assert.equal(box.height, undefined, `${selector} sizes to its content`);
      near(box.padX, at(px.padX, s), `${selector} padding at ${s}`);
      near(box.gap, at(px.gap, s), `${selector} gap at ${s}`);
      near(box.tracking, at(px.tracking, s), `${selector} tracking at ${s}`);
      near(box.strongTracking, at(px.tracking, s), `${selector} strong tracking at ${s}`);
      assert.equal(box.bold, px.bold, `${selector} weight`);
      near(box.fontSize, Math.max(at(px.font, s), 10), `${selector} type at ${s}`);
      near(box.strongFontSize, Math.max(at("strongFont" in px ? px.strongFont : px.font, s), 10), `${selector} b at ${s}`);
      if ("radius" in px) near(box.radius, at(px.radius, s), `${selector} radius at ${s}`);
    }
  }
});

// G1's approved line, tests/e2e/fixtures/notice-panel/index.html: padding=10 gap=6 radius=12 width=280.
test("the who-starts panel takes G1's numbers, and its lines keep the table's floor", () => {
  for (const s of SCALES) {
    const box = noticeBox("whoStarts", s);
    for (const [key, px] of [["padX", 10], ["padY", 10], ["gap", 6], ["radius", 12], ["width", 280]] as const) {
      near(box[key] ?? NaN, at(px, s), `#panel ${key} at ${s}`);
    }
    assert.equal(box.height, undefined, "the panel grows with its words");
    for (const [line, px] of [["main", 15], ["sub", 11], ["hint", 10]] as const) {
      near(panelLine(line, s).fontSize, Math.max(at(px, s), 10), `${line} type at ${s}`);
    }
  }
});

test("the lit and urgent pills glow as #turn.lit and #turn.urgent do, and no other selector glows", () => {
  for (const s of SCALES) {
    near(selectorGlow("#turn", "lit", s).plate, at(20.6, s), `lit glow at ${s}`);
    near(selectorGlow("#turn", "lit", s).dot, at(6, s), `#turn.lit .dot glow at ${s}`);
    near(selectorGlow("#turn", "urgent", s).plate, at(18, s), `urgent glow at ${s}`);
    assert.deepEqual(selectorGlow("#turn", "neutral", s), { plate: 0, dot: 0 });
    near(selectorBox("#turn", s).dot, at(6, s), `#turn .dot at ${s}`);
    for (const selector of [".chip", ".floatchip", ".passo", ".cchip", "#score", "#panel"] as const) {
      assert.deepEqual(selectorGlow(selector, "lit", s), { plate: 0, dot: 0 }, `${selector} lit`);
      assert.deepEqual(selectorGlow(selector, "urgent", s), { plate: 0, dot: 0 }, `${selector} urgent`);
    }
  }
});

// #1265's ember (the turn chip on main before plan 5): the dot glowing 9 pt, the plate 18 pt.
test("the ember pill keeps #1265's glow at every scale", () => {
  for (const s of [...SCALES, 1.07]) {
    near(noticeGlow("turn", "urgent", s).plate, 18 * s, `ember glow at ${s}`);
    near(noticeGlow("turn", "urgent", s).dot, 9 * s, `ember dot glow at ${s}`);
    assert.deepEqual(noticeGlow("turn", "lit", s), selectorGlow("#turn", "lit", s));
  }
});

test("the turn pill is #turn's box at every scale, its count #turn b's 12 px", () => {
  for (const s of [...SCALES, 1.07]) {
    assert.deepEqual(noticeBox("turn", s), selectorBox("#turn", s));
    near(noticeBox("turn", s).strongFontSize, Math.max(at(12, s), 10), `#turn b at ${s}`);
  }
  assert.deepEqual([...NOTICES.turn.tones].sort(), ["bad", "lit", "neutral", "ok", "urgent"]);
});

test("the connection tones are #turn.ok and #turn.bad; the dot blinks as .net's 0.9 s, still under reduced motion", () => {
  const { ok, bad } = NoticePalette.pill;
  assert.deepEqual([ok.edge, ok.ink, ok.dot.color], ["rgba(143,191,138,0.7)", "#D4ECCE", "#8FBF8A"]);
  assert.deepEqual([bad.edge, bad.ink, bad.dot.color], ["#D0574B", "#FFCFC6", "#E0806F"]);
  assert.deepEqual(noticeBlink(false), { half: 450, dim: 0.25 });
  assert.equal(noticeBlink(true), null);
});

// G2's approved line: offline.shape=pill offline.tone=solid; the fill deepened from Colors.danger to clear body contrast.
test("the offline pill is G2's #n-offline: a .chip with a 7 px gap, solid red with white ink", () => {
  for (const s of SCALES) {
    const box = noticeBox("offline", s);
    near(box.height ?? NaN, at(23.7, s), `height at ${s}`);
    near(box.padX, at(12, s), `padding at ${s}`);
    near(box.gap, at(7, s), `gap at ${s}`);
    near(box.fontSize, Math.max(at(10, s), 10), `type at ${s}`);
  }
  assert.deepEqual([...NOTICES.offline.tones], ["solid"]);
  const solid = NoticePalette.pill.solid;
  assert.deepEqual([solid.fill, solid.edge, solid.ink], ["#D32F2F", "#D32F2F", "#FFFFFF"]);
});

test("the lit pill is #turn.lit: its edge, its glow, its count and its dot", () => {
  const lit = NoticePalette.pill.lit;
  assert.equal(lit.edge, "rgba(243,224,166,0.8)");
  assert.deepEqual(lit.glow, { color: "#F3E0A6", opacity: 0.28 });
  assert.equal(lit.strong, "#F3E0A6");
  assert.deepEqual(lit.dot, { color: "#F3E0A6", glow: 1 });
});

test("a notice rises 6 mockup px, and not at all under reduced motion", () => {
  for (const s of SCALES) {
    near(noticeRise(s, false), at(6, s), `rise at ${s}`);
    assert.equal(noticeRise(s, true), 0);
  }
});

test("pills and panels take 160 ms; marks and floats 100 in, a 1000 hold, 100 out (Q1)", () => {
  for (const reduce of [false, true]) {
    assert.deepEqual(noticeTiming("pill", reduce), { enter: 160, hold: null, exit: 160 });
    assert.deepEqual(noticeTiming("panel", reduce), { enter: 160, hold: null, exit: 160 });
    assert.deepEqual(noticeTiming("chip", reduce), { enter: 100, hold: 1000, exit: 100 });
    assert.deepEqual(noticeTiming("float", reduce), { enter: 100, hold: 1000, exit: 100 });
  }
});

test("mark text never renders under the table's floor of 10 (Q3)", () => {
  for (const s of SCALES) {
    for (const mark of [".passo", ".cchip"] as const) assert.ok(selectorBox(mark, s).fontSize >= 10, `${mark} at ${s}`);
  }
  assert.equal(selectorBox(".passo", 1).fontSize, 10);
  assert.equal(selectorBox(".cchip", 1).fontSize, 10);
});

test("every kind's tones are paintable by its shape", () => {
  const kinds = Object.keys(NOTICES) as NoticeKind[];
  assert.ok(kinds.length > 0);
  for (const kind of kinds) {
    const { shape, tones } = NOTICES[kind];
    assert.ok(tones.length > 0, `${kind} declares no tone`);
    const paintable = NoticePalette[shape] as Record<string, unknown>;
    for (const tone of tones) assert.ok(tone in paintable, `${kind} is a ${shape}, which cannot paint ${tone}`);
  }
});

test("the gold edges map onto the five-step scale (Q4), and nothing paints the power red (Q5)", () => {
  assert.equal(NoticePalette.pill.neutral.edge, Colors.goldBorder);
  assert.equal(NoticePalette.pill.neutral.dot.color, Colors.gold, "#turn .dot's .8");
  assert.equal(NoticePalette.chip.neutral.edge, Colors.goldBorder);
  assert.equal(NoticePalette.chip.lit.edge, Colors.goldStrong);
  assert.equal(NoticePalette.panel.neutral.edge, Colors.goldStrong);
  const power = new Set([Colors.bombText, Colors.bombBorder, Colors.bombFill]);
  const painted = JSON.stringify(NoticePalette);
  for (const colour of power) assert.ok(!painted.includes(colour), `the notice palette paints ${colour}`);
});
