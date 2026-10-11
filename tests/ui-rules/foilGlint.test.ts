// tests/ui-rules/foilGlint.test.ts — a back's foil glint is the materials mockup's `drawBack`, run
// from its own lines (#1465).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { foilGlint, foilGlintColor } from "../../components/table/cardGloss.ts";
import { CardBacks, CardGloss, Pewter } from "../../lib/tokens.ts";
import { materialsLine, runFixture } from "../helpers/lanternFixture.ts";

const pose = /^ draw\((\{.+?\}),(lightAt\(x,y,lx,ly\)),n\);/.exec(materialsLine(" draw("))!;
const glint = materialsLine(" const half=Math.hypot(tw,th)/2");
const stops = [...materialsLine(" const g=tc.createLinearGradient").matchAll(/addColorStop\(([.\d]+),`rgba\(\$\{col\},(.+?)\)`\)/g)];

type Case = { x: number; y: number; rot: number; w: number; h: number; lx: number; ly: number };
const K = 2;

function mockup(k: Case) {
  const ctx = runFixture(
    [
      materialsLine("const clamp="),
      materialsLine("function lightAt("),
      materialsLine(" const vx=lx-x").trim(),
      `var L=${pose[1]},b=${pose[2]},dist=n,tw=w*k,th=h*k;`,
      glint.trim(),
      `var alphas=[${stops.map((s) => s[2].replace(/^\$\{(.+)\}$/, "$1")).join(",")}];`,
    ],
    { ...k, rot: (k.rot * Math.PI) / 180, k: K, bk: { silver: false } },
  ) as Record<string, number> & { alphas: number[] };
  return { x: (ctx.cx - ctx.tw / 2) / K, y: (ctx.cy - ctx.th / 2) / K, half: ctx.bw / K, edge: ctx.alphas[0], peak: ctx.alphas[1], end: ctx.alphas[2] };
}

const CASES: Case[] = [
  { x: 724, y: 330, rot: 6.88, w: 65, h: 95, lx: 437, ly: 180 },
  { x: 300, y: 120, rot: -30, w: 26, h: 38, lx: 457, ly: 292 },
  { x: 457, y: 330, rot: 0, w: 58, h: 84, lx: 457, ly: 320 },
  { x: 120, y: 360, rot: 90, w: 40, h: 58, lx: 700, ly: 60 },
  { x: 500, y: 200, rot: 0, w: 52, h: 76, lx: 500, ly: 200 },
];

const close = (actual: number, expected: number, what: string) => assert.ok(Math.abs(actual - expected) <= 1e-6, `${what}: ${actual} against the mockup's ${expected}`);

describe("a back's foil glint is the mockup's", () => {
  for (const k of CASES) {
    test(`back at ${k.x},${k.y} turned ${k.rot}°, lamp at ${k.lx},${k.ly}`, () => {
      const m = mockup(k);
      const g = foilGlint(k.x, k.y, k.rot, k.w, k.h, { lx: k.lx, ly: k.ly, level: 1, r: 1 });
      close(g.band.x, m.x, "offset x");
      close(g.band.y, m.y, "offset y");
      close(g.band.half, m.half, "half-width");
      close(g.peak, m.peak, "peak alpha");
      close(g.edge, m.edge, "edge alpha");
      close(g.edge, m.end, "far edge alpha");
      close(Math.sin(g.ang) * Math.hypot(m.x, m.y), m.x, "band axis x");
    });
  }

  test("the lamp's level dims the whole glint", () => {
    const k = CASES[0];
    const lit = foilGlint(k.x, k.y, k.rot, k.w, k.h, { lx: k.lx, ly: k.ly, level: 1, r: 1 });
    const dim = foilGlint(k.x, k.y, k.rot, k.w, k.h, { lx: k.lx, ly: k.ly, level: 0.4, r: 1 });
    close(dim.peak, lit.peak * 0.4, "peak at level 0.4");
    close(dim.edge, lit.edge * 0.4, "edge at level 0.4");
  });

  test("a pewter back glints silver, every other gold, in the mockup's colours", () => {
    const [gold, silver] = /col=bk\.silver\?'([\d,]+)':'([\d,]+)'/.exec(glint)!.slice(1).reverse();
    const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(",");
    assert.equal(rgb(CardGloss.foil.gold), gold);
    assert.equal(rgb(CardGloss.foil.silver), silver);
    assert.equal(Pewter, /PEWTER='(#[0-9A-F]{6})'/.exec(materialsLine("const GOLD="))![1]);
    for (const [id, back] of Object.entries(CardBacks)) {
      assert.equal(foilGlintColor(back.ink), back.ink === Pewter ? CardGloss.foil.silver : CardGloss.foil.gold, id);
    }
    assert.equal(foilGlintColor(CardBacks.zaffiro.ink), CardGloss.foil.silver);
  });
});
