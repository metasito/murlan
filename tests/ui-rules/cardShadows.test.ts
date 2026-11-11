// tests/ui-rules/cardShadows.test.ts — the felt's card shadows: the Lantern Table's, as the owner's
// ruling of 2026-11-03 (#1966) thins them (#1259 plan 4, task 12).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { addOutline, buildGlow, buildShadow, castOffset, handCardZ, pileGroupZ, restingCast, shadowClusters, feltContactPaths, inPath, shadowFall, shadowKind, shadowPaint, shadowShape, shadowClusterId, shadowTransform, SHADOW_PATHS, viewDrawsContact, type GlowSink, type PathSink } from "../../components/table/cardShadows.ts";
import type { CardRect } from "../../components/table/cardRects.ts";
import { CARD_ON_CARD_CSS } from "../e2e/helpers/cardOnCardCss.ts";
import { LIGHT_ABOVE } from "../../components/table/lampRig.ts";
import { CardGlow, CardShadow, Colors, Layer as Layers, Motion } from "../../lib/tokens.ts";
import { fixtureLine } from "../helpers/lanternFixture.ts";

// The owner's ruling of 2026-11-03 (#1966) overrides the mockup's shadow values: cards lie skin to skin.
describe("the card shadows are the owner's ruling, not the mockup's", () => {
  test("a card on a card casts only a contact: at most 0.5 pt down, 1 pt of blur, 0.35 of black", () => {
    assert.ok(CardShadow.contact.y <= 0.5 && CardShadow.contact.blur <= 1);
    for (const k of ["face", "back", "fan"] as const) assert.ok(CardShadow.alpha[k] <= 0.35, k);
    const { sigma, alpha } = shadowPaint("fan", 1);
    assert.ok(alpha <= 0.35 && sigma <= 0.5);
    assert.deepEqual(shadowFall("fan", { x: 457, y: 222 }, { x: 120, y: 40 }), { x: 0, y: CardShadow.contact.y });
  });

  test("a face's or back's contact is its own view's, which reads no lamp; no canvas draws a card on a card", () => {
    const src = (file: string) => fs.readFileSync(fileURLToPath(new URL(`../../${file}`, import.meta.url)), "utf8");
    const view = src("components/CardView.tsx");
    assert.match(view, /viewDrawsContact\(shadowKind\(rectKey, \{ back: faceDown \}\), drawsBoxShadow\(\)\)/);
    assert.match(src("components/table/feltCanvas.tsx"), /feltContactPaths\(drawsBoxShadow\(\)\)/);
    assert.match(view, /cardContact\(/);
    assert.doesNotMatch(src("lib/theme.ts").match(/export function cardContact[\s\S]*?\n}/)![0], /fall|cast|TABLE_CAST/);
    assert.deepEqual(fs.readdirSync(fileURLToPath(new URL("../../components/table/", import.meta.url))).filter((f) => /^handShade/.test(f)), []);
  });

  test("the Skia felt's passes paint the tokens, and the mockup's Skia-mode card-on-card is the contact tokens alone", () => {
    const felt = fs.readFileSync(fileURLToPath(new URL("../../components/table/feltCanvas.tsx", import.meta.url)), "utf8");
    assert.match(felt, /shadowPaint\(/);
    assert.match(felt, /shadowFall\(/);
    assert.doesNotMatch(felt, /CardShadow\.(cast|contact|fall)\.\w+\s*[*/+-]/);
    assert.ok(!CARD_ON_CARD_CSS.includes("var(--shx)"), CARD_ON_CARD_CSS);
    assert.ok(CARD_ON_CARD_CSS.includes(`.card{box-shadow:0 1.5px 0 #D6D0BC,0 .5px ${CardShadow.contact.blur}px rgba(0,0,0,.3)`), CARD_ON_CARD_CSS);
    assert.ok(CARD_ON_CARD_CSS.includes(`.card.bkc{box-shadow:0 .5px ${CardShadow.contact.blur}px rgba(0,0,0,.35)`), CARD_ON_CARD_CSS);
  });

  test("on the felt the cast is a third of the old (fall 26, 30, drop 3, blur 10), a lifted card's shadow larger", () => {
    assert.ok(CardShadow.fall.x >= 26 * 3 - 1 && CardShadow.fall.y >= 30 * 3 - 3 && CardShadow.fall.drop <= 1);
    assert.ok(CardShadow.cast.blur <= 10 / 3 + 0.5);
    assert.ok(CardShadow.lifted.blur > CardShadow.cast.blur && CardShadow.lifted.y > castOffset({ x: 457, y: 222 }, { x: 437, y: 360 }).y);
  });

  test("every contact and cast is black, and each path paints one of them", () => {
    assert.deepEqual(shadowPaint("cast", 1), { sigma: CardShadow.cast.blur / 2, alpha: CardShadow.cast.alpha });
    assert.deepEqual(shadowPaint("fan", 1), { sigma: CardShadow.contact.blur / 2, alpha: CardShadow.alpha.fan });
    assert.equal(Colors.shadow, "#000000");
  });

  test("the mockup carries the ruling's values, and its cast falls away from the light as `--shx`/`--shy` do", () => {
    for (const [rule, y, blur, a] of [[".card{", CardShadow.contact.y, CardShadow.contact.blur, CardShadow.alpha.face], [".card.bkc{", CardShadow.contact.y, CardShadow.contact.blur, CardShadow.alpha.back], [".bk{", CardShadow.contact.y, CardShadow.contact.blur, CardShadow.alpha.fan]] as const) {
      const css = /box-shadow:([^;}]+)/.exec(fixtureLine(rule))![1];
      assert.ok(css.includes(`0 ${y === 0.5 ? ".5" : y}px ${blur}px rgba(0,0,0,${String(a).replace(/^0/, "")})`), `${rule} ${css}`);
      if (rule !== ".bk{") assert.ok(css.includes(`var(--shx) var(--shy) ${CardShadow.cast.blur}px rgba(0,0,0,${String(CardShadow.cast.alpha).replace(/^0/, "")})`), `${rule} ${css}`);
    }
    const line = fixtureLine("  stage.style.setProperty('--shx'");
    const [, shx, shy] = /'--shx',\((.+?)\)\.toFixed\(1\)\+'px'\);stage\.style\.setProperty\('--shy',\((.+?)\)\.toFixed/.exec(line)!;
    const pile = { x: 457, y: 222 };
    for (const light of [{ x: 437, y: 360 }, { x: 120, y: 40 }, { x: 800, y: 222 }]) {
      const run = (expr: string) => vm.runInNewContext(expr, { PILE: [pile.x, pile.y], lx: light.x, ly: light.y }) as number;
      const got = castOffset(pile, light);
      assert.ok(Math.abs(got.x - run(shx)) < 1e-9 && Math.abs(got.y - run(shy)) < 1e-9, JSON.stringify({ light, got }));
    }
  });
});

describe("the shadow paths", () => {
  const rect = (over: Partial<CardRect> = {}): CardRect => ({ x: 100, y: 50, w: 64, h: 90, rot: 0, back: false, lift: 0, glow: 0, seen: 1, ...over });

  test("a seat fan's backs cast nothing and their contact is the felt's; every other card casts, and draws its own contact where the platform draws a view's boxShadow, else the felt does", () => {
    const keys = ["fan:top:0", "deal:3", "hand:5_clubs", "pile:a", "leg:x"];
    const kinds = keys.map((k, i) => shadowKind(k, { back: i === 1 }));
    assert.deepEqual(kinds, ["fan", "back", "face", "face", "face"]);
    assert.deepEqual(kinds.map((k) => viewDrawsContact(k, true)), [false, true, true, true, true]);
    assert.deepEqual(kinds.map((k) => viewDrawsContact(k, false)), [false, false, false, false, false]);
    assert.deepEqual(feltContactPaths(true), ["fan"]);
    assert.deepEqual(feltContactPaths(false), ["face", "back", "fan"]);
    for (const boxShadow of [true, false]) for (const k of kinds) assert.equal(feltContactPaths(boxShadow).filter((p) => inPath(p, k)).length + Number(viewDrawsContact(k, boxShadow)), 1, `${k} ${boxShadow}`);
    assert.deepEqual(kinds.map((k) => inPath("cast", k)), [false, true, true, true, true]);
    assert.deepEqual(kinds.map((k) => inPath("fan", k)), [true, false, false, false, false]);
    const counted = (path: (typeof SHADOW_PATHS)[number]) => {
      let n = 0;
      buildShadow({ moveTo: () => n++, lineTo: () => {}, conicTo: () => {}, close: () => {} }, path, { "fan:left:0": rect({ back: true }), "deal:0": rect({ back: true }), "pile:a": rect() }, { sx: 1, sy: 1, s: 1 }, 0);
      return n;
    };
    assert.deepEqual(SHADOW_PATHS.map(counted), [2, 1, 1, 1]);
  });

  test("split into the sets of cards whose blurs meet, each card in one of them", () => {
    const felt = { sx: 1, sy: 1, s: 1 };
    const at = (x: number, y = 50) => rect({ x, y, back: true });
    const rects = { "fan:right:0": at(800), "fan:left:0": at(100), "fan:top:0": at(400, 300), "fan:left:2": at(200), "fan:left:1": at(150), "pile:a": at(100, 300) };
    assert.deepEqual(shadowClusters("fan", rects, felt, 0, 3), [["fan:right:0"], ["fan:top:0"], ["fan:left:1", "fan:left:0", "fan:left:2"]]);
    const gap = (g: number) => shadowClusters("fan", { "fan:left:0": at(100), "fan:left:1": at(164 + g) }, felt, 0, 3).length;
    assert.deepEqual([gap(5.9), gap(6.1)], [1, 2]);
  });

  test("the pile paints by its groups' zIndex, the flight over every resting play", () => {
    assert.ok(pileGroupZ(false, false, "beaten") < pileGroupZ(false, false, "top"));
    assert.ok(pileGroupZ(false, false, "top") < pileGroupZ(false, true, "buried"));
    assert.ok(pileGroupZ(false, true, "top") < pileGroupZ(true, false, "top"));
  });

  test("the hand paints in its cards' zIndex order: a giveable card over its neighbours, the held card over all", () => {
    assert.deepEqual(handCardZ(2, 5, undefined), 2);
    assert.deepEqual(handCardZ(2, 5, true), 7);
    assert.ok(handCardZ(200, 500, true) < Layers.held, "a giveable lift stays under the held card");
  });

  test("are rebuilt for a change of any field they read, and not for a lift or glow alone", () => {
    const shape = (over: Partial<CardRect>, key = "hand:a") => shadowShape({ [key]: rect(over) });
    assert.equal(shape({ lift: 1, glow: 0.5 }), shape({}));
    const moved = [{ x: 101 }, { y: 51 }, { w: 65 }, { h: 91 }, { rot: 1 }, { back: true }, { seen: 0.5 }].map((o) => shape(o));
    assert.equal(new Set([shape({}), shape({}, "fan:top:0"), ...moved]).size, moved.length + 2);
  });

  test("a cluster is the same path for the same kind, felt and members' shapes, in any order", () => {
    const felt = { sx: 1, sy: 1, s: 1 };
    const rects = { "pile:a": rect(), "pile:b": rect({ x: 200 }), "pile:c": rect({ x: 900 }) };
    const id = (over: Partial<Record<string, CardRect>> = {}, f = felt, midX = 0, keys = ["pile:a", "pile:b"]) =>
      shadowClusterId("fan", { ...rects, ...over } as Record<string, CardRect>, f, midX, keys);
    assert.equal(id({}, felt, 0, ["pile:b", "pile:a"]), id());
    assert.equal(id({ "pile:c": rect({ x: 901 }) }), id());
    const changed = [id({ "pile:b": rect({ x: 201 }) }), id({}, { ...felt, sx: 2 }), id({}, { ...felt, sy: 2 }), id({}, { ...felt, s: 2 }), id({}, felt, 1), shadowClusterId("cast", rects, felt, 0, ["pile:a", "pile:b"])];
    assert.equal(new Set([id(), ...changed]).size, changed.length + 1);
  });

  test("a card's `shadow` pose is where its shadow is shaped, clustered and drawn; its glow stays on the card", () => {
    const felt = { sx: 1, sy: 1, s: 1 };
    const held = rect({ x: 300, rot: 4, glow: 1, shadow: { x: 100, y: 50, w: 64, h: 90, rot: 0 } });
    const there = rect({ glow: 1 });
    const first = (draw: (sink: GlowSink) => void) => {
      let at: number[] = [];
      draw({ moveTo: (x, y) => void (at = at.length ? at : [x, y]), lineTo: () => {}, conicTo: () => {}, close: () => {}, fill: () => {} });
      return at;
    };
    assert.equal(shadowShape({ "pile:a": held }), shadowShape({ "pile:a": there }));
    assert.deepEqual(first((s) => buildShadow(s, "cast", { "pile:a": held }, felt, 0)), first((s) => buildShadow(s, "cast", { "pile:a": there }, felt, 0)));
    assert.deepEqual(shadowClusters("cast", { "pile:a": held, "pile:b": rect({ x: 160 }) }, felt, 0, 3), [["pile:b", "pile:a"]]);
    assert.notDeepEqual(first((s) => buildGlow(s, { "pile:a": held }, felt, 0)), first((s) => buildGlow(s, { "pile:a": there }, felt, 0)));
  });

  function bounds(r: CardRect, felt = { sx: 2, sy: 1.5, s: 1.25 }, midX = 0) {
    const xs: number[] = [];
    const ys: number[] = [];
    const at = (x: number, y: number) => void (xs.push(x), ys.push(y));
    const sink: PathSink = { moveTo: at, lineTo: at, conicTo: (_x1, _y1, x, y) => at(x, y), close: () => {} };
    addOutline(sink, r, felt, midX);
    return xs.length ? { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) } : null;
  }
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

  test("a card's outline is its window box, centre by the felt's axes and size by the card scale", () => {
    const b = bounds(rect())!;
    assert.ok(near(b.x0, 200 - 40) && near(b.x1, 200 + 40) && near(b.y0, 75 - 56.25) && near(b.y1, 75 + 56.25), JSON.stringify(b));
    const turned = bounds(rect({ rot: 90 }))!;
    assert.ok(near(turned.x0, 200 - 56.25) && near(turned.y1, 75 + 40), JSON.stringify(turned));
  });

  test("a card its row cuts keeps the part toward the row's middle, and a hidden one none", () => {
    const b = bounds(rect({ seen: 0.25 }), undefined, 1000)!;
    assert.ok(near(b.x0, 240 - 20) && near(b.x1, 240), JSON.stringify(b));
    assert.equal(bounds(rect({ seen: 0 })), null);
  });

  test("where the felt's axes and card scale all differ, each shadow lands and blurs where the ruling puts it", () => {
    const felt = { sx: 1180 / 874, sy: 820 / 402, s: 1.6 };
    const r = rect({ x: 430, y: 200, rot: 12 });
    const pile = { x: 457, y: 222 };
    const light = { x: 300, y: 330 };
    const onScreen = (steps: Record<string, number>[], p: { x: number; y: number }) =>
      steps.reduceRight((q, t) => ({ x: q.x * (t.scaleX ?? 1) + (t.translateX ?? 0), y: q.y * (t.scaleY ?? 1) + (t.translateY ?? 0) }), p);
    const b = bounds(r, felt)!;
    for (const path of SHADOW_PATHS) {
      const css = path === "cast" ? { x: (pile.x - light.x) / 78, y: 1 + (pile.y - light.y) / 90, blur: CardShadow.cast.blur } : { x: 0, y: CardShadow.contact.y, blur: CardShadow.contact.blur };
      const got = onScreen([{ scaleX: felt.sx }, { scaleY: felt.sy }, ...shadowTransform(shadowFall(path, pile, light), felt)], { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 });
      assert.ok(near(got.x, r.x * felt.sx + css.x * felt.s) && near(got.y, r.y * felt.sy + css.y * felt.s), `${path}: ${JSON.stringify(got)}`);
      assert.ok(near(2 * shadowPaint(path, felt.s).sigma, css.blur * felt.s), path);
    }
  });

  test("the web fallback's still cast is the lamp's, from where it is headed", () => {
    const felt = { sx: 2, sy: 1.5, s: 1.25 };
    const o = castOffset({ x: 457, y: 222 }, { x: 300, y: 300 - LIGHT_ABOVE });
    assert.deepEqual(restingCast({ x: 914, y: 333 }, [300, 300, 1], felt), { x: o.x * 1.25, y: o.y * 1.25 });
  });
});

describe("the felt's gold glow", () => {
  const rect = (over: Partial<CardRect> = {}): CardRect => ({ x: 100, y: 50, w: 64, h: 90, rot: 0, back: false, lift: 0, glow: 0, seen: 1, ...over });

  test("is G1's, as its fixture's defaults", () => {
    const fixture = fs.readFileSync(path.resolve(import.meta.dirname, "..", "e2e", "fixtures", "card-glow", "index.html"), "utf8");
    const g0 = vm.runInNewContext(`(${/^const G0=(\{.*?\});$/m.exec(fixture)![1]})`) as Record<string, unknown>;
    assert.deepEqual({ ...g0 }, { color: CardGlow.color, opacity: CardGlow.alpha, blur: CardGlow.blur, spread: 0, fade: Motion.duration.tap, follow: false });
  });

  test("fills each glowing card's own outline once, at its own strength", () => {
    const fills: [number, number][] = [];
    let moves = 0;
    const sink: GlowSink = { moveTo: () => moves++, lineTo: () => {}, conicTo: () => {}, close: () => {}, fill: (a) => fills.push([moves, a]) };
    const rects = { "hand:a": rect({ glow: 1 }), "hand:b": rect(), "pile:c": rect({ glow: 0.5 }), "hand:d": rect({ glow: 1, seen: 0 }) };
    buildGlow(sink, rects, { sx: 1, sy: 1, s: 1 }, 0);
    assert.deepEqual(fills, [[1, CardGlow.alpha], [2, CardGlow.alpha / 2]]);
  });
});
