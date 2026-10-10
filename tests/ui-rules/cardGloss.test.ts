// tests/ui-rules/cardGloss.test.ts — a card's lamp gloss is the Lantern Table's `gloss()`, run from the
// mockup's own lines (#1260).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { cardGloss } from "../../components/table/cardGloss.ts";
import { CardGloss } from "../../lib/tokens.ts";
import { fixtureLine, runFixture } from "../helpers/lanternFixture.ts";

const LOOP = "  for(const[c,cx,cy]of list){";
const perCard = fixtureLine(LOOP).slice(LOOP.length);
const streak = fixtureLine("    const ang=").trim();
const paint = fixtureLine("    c._gl.style.background=");

type Case = { cx: number; cy: number; w: number; h: number; lx: number; ly: number; L: number };

function mockup(k: Case, falloff = "440") {
  const statements = [fixtureLine("const clamp="), perCard.replace("/440)", `/${falloff})`), streak];
  const [, sx, sy] = /circle \d+px at \$\{\((.+?)\)\.toFixed\(1\)\}px \$\{\((.+?)\)\.toFixed\(1\)\}px/.exec(paint)!;
  statements.push(`var spotX=${sx},spotY=${sy};`);
  return runFixture(statements, { c: { _w: k.w, _h: k.h }, cx: k.cx, cy: k.cy, lx: k.lx, ly: k.ly, lamp: { L: k.L } }) as Record<string, number>;
}

const CASES: Case[] = [
  { cx: 437, cy: 330, w: 58, h: 84, lx: 437, ly: 180, L: 1 },
  { cx: 300, cy: 200, w: 52, h: 76, lx: 520, ly: 120, L: 0.6 },
  { cx: 780, cy: 90, w: 40, h: 58, lx: 437, ly: 200, L: 0.85 },
  { cx: 120, cy: 360, w: 58, h: 84, lx: 140, ly: 340, L: 0.3 },
  { cx: 437, cy: 201, w: 52, h: 76, lx: 437, ly: 201, L: 1 },
];

const close = (actual: number, expected: number, what: string) => assert.ok(Math.abs(actual - expected) <= 1e-6, `${what}: ${actual} against the mockup's ${expected}`);

describe("a card's gloss is the mockup's", () => {
  for (const k of CASES) {
    test(`card at ${k.cx},${k.cy}, lamp at ${k.lx},${k.ly}, level ${k.L}`, () => {
      const m = mockup(k);
      const g = cardGloss(k.cx, k.cy, k.w, k.h, { lx: k.lx, ly: k.ly, level: k.L, r: 1 });
      close(g.spot.x, m.spotX, "spot x");
      close(g.spot.y, m.spotY, "spot y");
      close(g.ang, m.ang, "ang");
      close(g.cp, m.cp, "cp");
      close(g.wp, m.wp, "wp");
      close(g.a, m.a, "a");
    });
  }

  test("the falloff scales with the lamp's reach", () => {
    const k = CASES[1];
    const m = mockup(k, "(440*1.5)");
    const g = cardGloss(k.cx, k.cy, k.w, k.h, { lx: k.lx, ly: k.ly, level: k.L, r: 1.5 });
    close(g.a, m.a, "a at reach 1.5");
    assert.ok(g.a > cardGloss(k.cx, k.cy, k.w, k.h, { lx: k.lx, ly: k.ly, level: k.L, r: 1 }).a);
  });

  test("the band is the CSS gradient line's peak and half-width, in design points", () => {
    for (const k of CASES) {
      const g = cardGloss(k.cx, k.cy, k.w, k.h, { lx: k.lx, ly: k.ly, level: k.L, r: 1 });
      const len = Math.abs(k.w * Math.sin(g.ang)) + Math.abs(k.h * Math.cos(g.ang));
      close(g.band.x, Math.sin(g.ang) * ((g.cp - 50) / 100) * len, "band x");
      close(g.band.y, -Math.cos(g.ang) * ((g.cp - 50) / 100) * len, "band y");
      close(g.band.half, (g.wp / 100) * len, "band half-width");
    }
  });

  test("the spot's radius, stops and colours are the mockup's", () => {
    assert.equal(Number(/circle (\d+)px/.exec(paint)![1]), CardGloss.spot.radius);
    const stops = [...paint.matchAll(/rgba\((\d+),(\d+),(\d+),\$\{\(([.\d]+)\*lamp\.L\)/g)].map((s) => [s.slice(1, 4).map(Number), Number(s[4])]);
    const hex = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
    assert.deepEqual(stops, [
      [hex(CardGloss.spot.color), CardGloss.spot.alpha],
      [hex(CardGloss.spot.mid.color), CardGloss.spot.mid.alpha],
    ]);
    assert.match(paint, new RegExp(`\\) ${CardGloss.spot.mid.at * 100}%,`));
    assert.match(paint, new RegExp(`rgba\\(${hex(CardGloss.streak.color).join(",")},\\$\\{a\\.toFixed`));
  });
});
