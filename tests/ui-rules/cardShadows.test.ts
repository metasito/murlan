// tests/ui-rules/cardShadows.test.ts — the felt's card shadows are the Lantern Table's, read from the
// mockup's own `.card`, `.card.bkc`, `.bk` and `--shx`/`--shy` (#1259 plan 4, task 12).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { addOutline, buildShadow, castOffset, restingCast, shadowKind, shadowPaint, SHADOW_PATHS, type PathSink } from "../../components/table/cardShadows.ts";
import type { CardRect } from "../../components/table/cardRects.ts";
import { LIGHT_ABOVE } from "../../components/table/lampRig.ts";
import { NAME_CONTRAST, nameShade } from "../../components/table/legibilityRing.ts";
import { CardShadow, Colors, FeltGradients } from "../../lib/tokens.ts";
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
    assert.deepEqual(shadowPaint("cast"), { dy: 0, sigma: CardShadow.cast.blur / 2, alpha: CardShadow.cast.alpha });
    for (const k of ["face", "back", "fan"] as const) assert.deepEqual(shadowPaint(k), { dy: CardShadow.contact.y, sigma: CardShadow.contact.blur / 2, alpha: CardShadow.alpha[k] });
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

  test("the web fallback's still cast is the lamp's, from where it is headed", () => {
    const felt = { sx: 2, sy: 1.5, s: 1.25 };
    const o = castOffset({ x: 457, y: 222 }, { x: 300, y: 300 - LIGHT_ABOVE });
    assert.deepEqual(restingCast({ x: 914, y: 333 }, [300, 300, 1], felt), { x: o.x * 1.25, y: o.y * 1.25 });
  });
});

describe("the felt under a seat name", () => {
  const channel = (c: number) => (c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
  const lum = (hex: string) => [1, 3, 5].map((i) => channel(parseInt(hex.slice(i, i + 2), 16))).reduce((s, v, i) => s + [0.2126, 0.7152, 0.0722][i] * v, 0);

  test("is dark enough for the lit name's gold on every felt", () => {
    for (const stops of Object.values(FeltGradients)) {
      const ratio = (lum(Colors.goldLit) + 0.05) / (lum(nameShade(stops, Colors.goldLit)) + 0.05);
      assert.ok(ratio >= NAME_CONTRAST - 0.05 && ratio >= 4.5, `${stops[0]}: ${ratio}`);
    }
  });
});
