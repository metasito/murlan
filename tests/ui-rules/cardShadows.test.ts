// tests/ui-rules/cardShadows.test.ts — the felt's card shadows are the Lantern Table's, read from the
// mockup's own `.card`, `.card.bkc`, `.bk` and `--shx`/`--shy` (#1259 plan 4, task 12).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { addOutline, buildGlow, buildShadow, castOffset, restingCast, shadowClusters, shadowFall, shadowKind, shadowPaint, shadowShape, shadowClusterId, shadowTransform, SHADOW_PATHS, type GlowSink, type PathSink } from "../../components/table/cardShadows.ts";
import type { CardRect } from "../../components/table/cardRects.ts";
import { LIGHT_ABOVE } from "../../components/table/lampRig.ts";
import { CardGlow, CardShadow, Colors, Motion } from "../../lib/tokens.ts";
import { fixtureLine } from "../helpers/lanternFixture.ts";

type Layer = { x: string; y: string; blur: number; rgba: number[] | null; hex: string | null; inset: boolean };

function shadows(rule: string): Layer[] {
  const css = /box-shadow:([^;}]+)/.exec(fixtureLine(rule))![1];
  return css.split(/,(?![^(]*\))/).map((layer) => {
    const inset = layer.includes("inset");
    const rgba = /rgba\(([^)]*)\)/.exec(layer)?.[1].split(",").map(Number) ?? null;
    const hex = /#[0-9A-Fa-f]{6}/.exec(layer)?.[0] ?? null;
    const [x, y, blur] = layer.replace(/rgba\([^)]*\)|#[0-9A-Fa-f]{6}|inset/g, "").trim().split(/\s+/);
    return { x, y, blur: parseFloat(blur), rgba, hex, inset };
  });
}

const cast = (layers: Layer[]) => layers.filter((l) => l.x === "var(--shx)");
const contact = (layers: Layer[]) => layers.filter((l) => !l.inset && l.x !== "var(--shx)" && l.rgba);

describe("the felt's card shadows are the mockup's", () => {
  const face = shadows(".card{");
  const back = shadows(".card.bkc{");
  const fan = shadows(".bk{");

  test("a face: its lip, its contact, its cast", () => {
    assert.equal(face[0].hex, Colors.cardLip);
    assert.deepEqual(contact(face).map((l) => [parseFloat(l.x), parseFloat(l.y), l.blur, l.rgba![3]]), [[0, CardShadow.contact.y, CardShadow.contact.blur, CardShadow.alpha.face]]);
    assert.deepEqual(cast(face).map((l) => [l.y, l.blur, l.rgba![3]]), [["var(--shy)", CardShadow.cast.blur, CardShadow.cast.alpha]]);
  });

  test("a back on the felt: its contact, its cast", () => {
    assert.deepEqual(contact(back).map((l) => [parseFloat(l.y), l.blur, l.rgba![3]]), [[CardShadow.contact.y, CardShadow.contact.blur, CardShadow.alpha.back]]);
    assert.deepEqual(cast(back).map((l) => [l.blur, l.rgba![3]]), [[CardShadow.cast.blur, CardShadow.cast.alpha]]);
  });

  test("a seat fan's back: its contact alone", () => {
    assert.deepEqual(contact(fan).map((l) => [parseFloat(l.y), l.blur, l.rgba![3]]), [[CardShadow.contact.y, CardShadow.contact.blur, CardShadow.alpha.fan]]);
    assert.equal(cast(fan).length, 0);
  });

  test("every contact and cast is black, and each path paints one of them", () => {
    for (const l of [...contact(face), ...contact(back), ...contact(fan), ...cast(face), ...cast(back)]) assert.deepEqual(l.rgba!.slice(0, 3), [0, 0, 0]);
    assert.deepEqual(shadowPaint("cast", 1), { sigma: CardShadow.cast.blur / 2, alpha: CardShadow.cast.alpha });
    for (const k of ["face", "back", "fan"] as const) assert.deepEqual(shadowPaint(k, 1), { sigma: CardShadow.contact.blur / 2, alpha: CardShadow.alpha[k] });
  });

  test("the cast falls away from the light as `--shx`/`--shy` do", () => {
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

  test("a seat fan's backs cast nothing; every other card casts", () => {
    assert.equal(shadowKind("fan:top:0", rect({ back: true })), "fan");
    assert.equal(shadowKind("deal:3", rect({ back: true })), "back");
    assert.equal(shadowKind("hand:5_clubs", rect()), "face");
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
      shadowClusterId("face", { ...rects, ...over } as Record<string, CardRect>, f, midX, keys);
    assert.equal(id({}, felt, 0, ["pile:b", "pile:a"]), id());
    assert.equal(id({ "pile:c": rect({ x: 901 }) }), id());
    const changed = [id({ "pile:b": rect({ x: 201 }) }), id({}, { ...felt, sx: 2 }), id({}, { ...felt, sy: 2 }), id({}, { ...felt, s: 2 }), id({}, felt, 1), shadowClusterId("cast", rects, felt, 0, ["pile:a", "pile:b"])];
    assert.equal(new Set([id(), ...changed]).size, changed.length + 1);
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

  test("where the felt's axes and card scale all differ, each shadow lands and blurs where the mockup's card would", () => {
    const felt = { sx: 1180 / 874, sy: 820 / 402, s: 1.6 };
    const r = rect({ x: 430, y: 200, rot: 12 });
    const pile = { x: 457, y: 222 };
    const light = { x: 300, y: 330 };
    const [, shx, shy] = /'--shx',\((.+?)\)\.toFixed\(1\)\+'px'\);stage\.style\.setProperty\('--shy',\((.+?)\)\.toFixed/.exec(fixtureLine("  stage.style.setProperty('--shx'"))!;
    const run = (expr: string) => vm.runInNewContext(expr, { PILE: [pile.x, pile.y], lx: light.x, ly: light.y }) as number;
    const onScreen = (steps: Record<string, number>[], p: { x: number; y: number }) =>
      steps.reduceRight((q, t) => ({ x: q.x * (t.scaleX ?? 1) + (t.translateX ?? 0), y: q.y * (t.scaleY ?? 1) + (t.translateY ?? 0) }), p);
    const b = bounds(r, felt)!;
    for (const path of SHADOW_PATHS) {
      const css = path === "cast" ? { x: run(shx), y: run(shy), blur: CardShadow.cast.blur } : { x: 0, y: CardShadow.contact.y, blur: CardShadow.contact.blur };
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
