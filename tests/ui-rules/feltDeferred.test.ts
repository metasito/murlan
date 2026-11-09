// tests/ui-rules/feltDeferred.test.ts — the felt bakes the cloth's lamp-free terms once per size
// and lights them each frame. Lit from 8-bit planes on CanvasKit's CPU raster, the cloth must
// match the one-pass shader to under one 8-bit level, wherever the lamp is.
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { CLOTH_SKSL, FELT_K_CAP, FLARE_SEEN, HAND_CLOTH_SKSL, HAND_LIT_SKSL, LIT_SKSL, REST_SKSL, WEAVE_PLANES, WEAVE_SKSL, clothUniforms, flareShare, settledDraws, weaveUniforms, type ClothUniforms } from "../../components/table/feltShader.ts";
import { LIGHT_ABOVE, SWAY, TABLE_CENTRE, lampControls, lightUniforms, restingLamp, stepLamp } from "../../components/table/lampRig.ts";
import { FeltGradients } from "../../lib/tokens.ts";

const require = createRequire(import.meta.url);

/** Device pixels per design point on each axis: DPR 1, a DPR 2 phone, between, the felt's cap, and a window wider than the table. The cloth's `uK` is the lesser. */
type Density = readonly [gx: number, gy: number];
const DENSITIES: Density[] = [[1, 1], [2, 2], [2.2, 2.2], [FELT_K_CAP, FELT_K_CAP], [FELT_K_CAP, 2.2]];
const kOf = ([gx, gy]: Density) => Math.min(gx, gy);
const LAMPS: [x: number, y: number][] = [
  [437, 362],
  [784, 201],
  [437, 80],
  [90, 201],
  [610, 290],
];
const LIGHTS = [
  { uFlare: 0, reach: 1 },
  { uFlare: 1, reach: 1 },
  { uFlare: 0.4, reach: 0.8 },
];
const TILE = 32;
/** Design points: the felt's rounded corner, and round each lamp. */
const EDGE = [106, 46] as const;
const tiles = (lamp: [number, number]) => [EDGE, [lamp[0] - TILE / 2, lamp[1] - TILE / 2]] as const;
const FELTS = ["verde", "blu", "bordeaux", "notte"] as const;

const LEVEL = 1 / 255;

type CK = any;
let ck: CK;
let cloth: CK;
let weave: CK;
let lit: CK;
let rest: CK;
let handLit: CK;
let handCloth: CK;

before(async () => {
  const init = require("canvaskit-wasm/bin/full/canvaskit.js");
  ck = await init({ locateFile: (f: string) => require.resolve(`canvaskit-wasm/bin/full/${f}`) });
  const make = (sksl: string, name: string) => {
    const errors: string[] = [];
    const effect = ck.RuntimeEffect.Make(sksl, (e: string) => errors.push(e));
    assert.ok(effect, `${name} does not compile as SkSL: ${errors.join("\n")}`);
    return effect;
  };
  cloth = make(CLOTH_SKSL, "the cloth");
  weave = make(WEAVE_SKSL, "the weave");
  lit = make(LIT_SKSL, "the lit cloth");
  rest = make(REST_SKSL, "the settled felt");
  handLit = make(HAND_LIT_SKSL, "the hand-over over the planes");
  handCloth = make(HAND_CLOTH_SKSL, "the hand-over over the cloth");
});

function flat(effect: CK, values: ClothUniforms): Float32Array {
  const out = new Float32Array(effect.getUniformFloatCount());
  for (let i = 0; i < effect.getUniformCount(); i++) {
    const name = effect.getUniformName(i);
    const v = values[name];
    assert.ok(v !== undefined, `no value for ${name}`);
    out.set(typeof v === "number" ? [v] : v, effect.getUniform(i).slot);
  }
  return out;
}

type Layer = [shader: CK, alpha: number];

/** The tile at `origin`, `TILE` points square, drawn at `g` device pixels a point: each layer over the last, at its paint's alpha. */
function draw(surface: CK, [gx, gy]: Density, origin: readonly [number, number], layers: CK | Layer[]) {
  const canvas = surface.getCanvas();
  canvas.clear(ck.TRANSPARENT);
  canvas.save();
  canvas.scale(gx, gy);
  canvas.translate(-origin[0], -origin[1]);
  for (const [shader, alpha] of Array.isArray(layers) ? layers : [[layers, 1] as Layer]) {
    const paint = new ck.Paint();
    paint.setShader(shader);
    paint.setAlphaf(alpha);
    canvas.drawRect(ck.XYWHRect(origin[0], origin[1], TILE, TILE), paint);
    paint.delete();
  }
  canvas.restore();
  surface.flush();
}

const sides = ([gx, gy]: Density) => [Math.round(TILE * gx), Math.round(TILE * gy)] as const;

function floats(g: Density, origin: readonly [number, number], shader: CK | Layer[]): Float32Array {
  const [width, height] = sides(g);
  const info = { width, height, colorType: ck.ColorType.RGBA_F32, alphaType: ck.AlphaType.Premul, colorSpace: ck.ColorSpace.SRGB };
  const mem = ck.Malloc(Float32Array, width * height * 4);
  const surface = ck.MakeRasterDirectSurface(info, mem, width * 16);
  draw(surface, g, origin, shader);
  const out = Float32Array.from(mem.toTypedArray());
  surface.delete();
  ck.Free(mem);
  return out;
}

/** A tile as the felt bakes it: an 8-bit surface, read back nearest at the pixel it was baked on. */
function baked(g: Density, origin: readonly [number, number], shader: CK): CK {
  const [width, height] = sides(g);
  const place = ck.Matrix.multiply(ck.Matrix.translated(origin[0], origin[1]), ck.Matrix.scaled(1 / g[0], 1 / g[1]));
  const surface = ck.MakeSurface(width, height);
  draw(surface, g, origin, shader);
  const image = surface.makeImageSnapshot();
  const child = image.makeShaderOptions(ck.TileMode.Clamp, ck.TileMode.Clamp, ck.FilterMode.Nearest, ck.MipmapMode.None, place);
  surface.delete();
  image.delete();
  return child;
}

function planes(g: Density, origin: readonly [number, number]): CK[] {
  return Array.from({ length: WEAVE_PLANES }, (_, plane) => {
    const shader = weave.makeShader(flat(weave, weaveUniforms(kOf(g), plane)));
    const child = baked(g, origin, shader);
    shader.delete();
    return child;
  });
}

interface Gap {
  worst: number;
  where: string;
  inside: number;
}

function gap(stops: readonly string[], g: Density, lamp: [number, number], light: (typeof LIGHTS)[number], origin: readonly [number, number]): Gap {
  const values: ClothUniforms = { ...clothUniforms(stops as never, kOf(g)), ...lightUniforms(light.reach), uLamp: lamp, uFlare: light.uFlare };
  const one = cloth.makeShader(flat(cloth, values));
  const children = planes(g, origin);
  const two = lit.makeShaderWithChildren(flat(lit, values), children);
  const want = floats(g, origin, one);
  const got = floats(g, origin, two);
  [one, two, ...children].forEach((s) => s.delete());
  let worst = 0;
  let at = 0;
  let inside = 0;
  for (let i = 0; i < want.length; i++) {
    if (i % 4 === 3 && want[i] > 0) inside++;
    const d = Math.abs(want[i] - got[i]);
    if (d > worst) [worst, at] = [d, i];
  }
  const px = Math.floor(at / 4);
  const side = sides(g)[0];
  const where = `g ${g}, lamp (${lamp}), flare ${light.uFlare}, reach ${light.reach}, tile (${origin}) px (${px % side}, ${Math.floor(px / side)}) channel ${at % 4}: ${want[at]} want, ${got[at]} got`;
  return { worst, where, inside };
}

/** `vec4 cloth(...)` through the brace that closes it. */
function clothOf(sksl: string): string {
  const at = sksl.indexOf("vec4 cloth(");
  assert.ok(at >= 0, "no vec4 cloth( in the shader");
  let depth = 0;
  for (let i = sksl.indexOf("{", at); i >= 0 && i < sksl.length; i++) {
    if (sksl[i] === "{") depth++;
    if (sksl[i] === "}" && --depth === 0) return sksl.slice(at, i + 1);
  }
  assert.fail("vec4 cloth( never closes");
}

const TARGET = LAMPS[4];
const RAIL = [0.31, 0.17, 0.09, 1] as const;

/** A settled felt's tile: its ends baked as the canvas bakes them, the live cloth with the lamp `lean` of the way across its sway, and the shaders that lay them. */
function settledTile(stops: readonly string[], g: Density, lean: number, origin: readonly [number, number], over: boolean, flare = 0.4) {
  const [tx, ty] = TARGET;
  const base = { ...clothUniforms(stops as never, kOf(g)), ...lightUniforms(1) };
  const weave = over ? planes(g, origin) : [];
  const own = (dx: number, flare: number) => {
    const values: ClothUniforms = { ...base, uLamp: [tx + dx, ty - LIGHT_ABOVE], uFlare: flare };
    return over ? lit.makeShaderWithChildren(flat(lit, values), weave) : cloth.makeShader(flat(cloth, values));
  };
  const ends = [-SWAY, SWAY].map((dx) => {
    const shader = own(dx, 0);
    const child = baked(g, origin, shader);
    shader.delete();
    return child;
  });
  const live = own((2 * lean - 1) * SWAY, flare);
  const values: ClothUniforms = { ...base, uLamp: [tx + (2 * lean - 1) * SWAY, ty - LIGHT_ABOVE], uFlare: flare, uLean: lean };
  const settled = rest.makeShaderWithChildren(flat(rest, { uLean: lean }), ends);
  const hand = (w: number) => (over ? handLit : handCloth).makeShaderWithChildren(flat(over ? handLit : handCloth, { ...values, uW: w }), [...weave, ...ends]);
  const rail = ck.Shader.MakeColor(ck.Color4f(...RAIL), ck.ColorSpace.SRGB);
  const free = () => [live, settled, rail, ...weave, ...ends].forEach((s) => s.delete());
  return { ends, live, settled, hand, rail, free };
}

/** The felt over its rail at `w`, through the draws `settledDraws` picks. */
function felt(g: Density, origin: readonly [number, number], tile: ReturnType<typeof settledTile>, w: number): Float32Array {
  const d = settledDraws(w);
  const hand = tile.hand(w);
  const out = floats(g, origin, [
    [tile.rail, 1],
    [tile.settled, d.cross],
    [hand, d.hand],
  ]);
  hand.delete();
  return out;
}

const worstApart = (a: Float32Array, b: Float32Array) => a.reduce((m, v, i) => Math.max(m, Math.abs(v - b[i])), 0);

describe("the felt lit from its baked weave is the cloth", () => {
  test("the lit pass reads the weave from its planes, not from the cloth's own noise", () => {
    assert.ok(LIT_SKSL.includes("uG0.eval(p)") && LIT_SKSL.includes(`uG${WEAVE_PLANES - 1}.eval(p)`), "the lit cloth reads no plane");
    assert.ok(CLOTH_SKSL.includes("vn(vec2(tid*1.7") && CLOTH_SKSL.includes("h21(floor(p*uK))"), "the cloth no longer draws the slub and fuzz this test looks for");
    assert.ok(!LIT_SKSL.includes("vn(vec2(tid*1.7"), "the lit cloth still draws the slub");
    assert.ok(!LIT_SKSL.includes("h21(floor(p*uK))"), "the lit cloth still draws the fuzz");
  });

  test("the lit pass: every term the lamp does not move is baked, so a lit pixel costs two reads and the lamp's own terms", () => {
    assert.equal(WEAVE_PLANES, 2);
    const body = clothOf(LIT_SKSL);
    assert.ok(body.includes("uG0.eval(p)") && body.includes("uG1.eval(p)"), `the lit cloth reads no plane: ${body}`);
    for (const term of ["prof", "tv", "mott", "vis", "uDepth", "uCover", "uFuzz", "uSheen", "uMott", "uTwo"]) {
      assert.ok(!new RegExp(`\\b${term}\\b`).test(body), `the lit cloth still computes ${term} per pixel`);
    }
  });

  test("a settled felt at rest is one shader of its two ends' reads, so a masked rasteriser never runs the cloth", () => {
    assert.equal(REST_SKSL.match(/\.eval\(/g)?.length, 2);
    for (const term of ["cloth(", "uG0", "uW", "if("]) assert.ok(!REST_SKSL.includes(term), `the settled felt carries ${term}`);
    for (const w of [0, 0.01, 0.5, 1]) assert.ok(settledDraws(w).cross + settledDraws(w).hand === 1, `w ${w} draws the felt ${settledDraws(w).cross + settledDraws(w).hand} times`);
    assert.deepEqual(settledDraws(0), { cross: 1, hand: 0 });
  });

  for (const name of FELTS) {
    const stops = FeltGradients[name];
    test(`${name}: under one 8-bit level from the one-pass cloth, at every density and lamp`, () => {
      let worst: Gap = { worst: 0, where: "nowhere", inside: 0 };
      let inside = 0;
      for (const g of DENSITIES) {
        for (const lamp of LAMPS) {
          for (const light of LIGHTS) {
            for (const origin of tiles(lamp)) {
              const one = gap(stops, g, lamp, light, origin);
              inside += one.inside;
              if (one.worst > worst.worst) worst = one;
            }
          }
        }
      }
      assert.ok(inside > 0, "no tile drew any felt");
      assert.ok(worst.worst < LEVEL, `${(worst.worst / LEVEL).toFixed(3)} levels apart at ${worst.where}`);
      console.log(`${name}: worst ${(worst.worst / LEVEL).toFixed(3)} levels at ${worst.where}`);
    });
  }

  test("a fading flare hands a settled felt back to its cross a twentieth at a time, from all of it to none", () => {
    const lamp = restingLamp(TABLE_CENTRE);
    lampControls.flare(lamp, false);
    const shares: number[] = [];
    for (let frame = 0; frame < 600; frame++) {
      stepLamp(lamp, 1 / 60, false);
      shares.push(flareShare(lamp.f));
    }
    assert.equal(shares[0], 1);
    assert.equal(shares.at(-1), 0);
    assert.equal(flareShare(FLARE_SEEN), 0);
    const steps = shares.slice(1).map((s, i) => shares[i] - s);
    assert.ok(steps.every((d) => d >= 0), "the share rises while the flare fades");
    assert.ok(Math.max(...steps) < 1 / 20, `a frame hands back ${Math.max(...steps)} of the felt`);
  });

  for (const over of [true, false]) {
    test(`over the rail, the settled felt ${over ? "over the planes" : "over the cloth"} is main's two crossed ends at 0, the live cloth at 1, and the line between them, edge included`, () => {
      const lean = 0.3;
      for (const g of DENSITIES) {
        for (const origin of tiles(TARGET)) {
          const tile = settledTile(FeltGradients.verde, g, lean, origin, over);
          const main = floats(g, origin, [
            [tile.rail, 1],
            [tile.ends[0], 1],
            [tile.ends[1], lean],
          ]);
          const live = floats(g, origin, [
            [tile.rail, 1],
            [tile.live, 1],
          ]);
          if (origin === EDGE) {
            const edge = floats(g, origin, tile.ends[0]).filter((a, i) => i % 4 === 3 && a > 0 && a < 1).length;
            assert.ok(edge > 0, `g ${g}: the corner tile has no edge pixel`);
          }
          const at = (w: number) => felt(g, origin, tile, w);
          for (const w of [0, 0.01, 0.5, 0.99, 1]) {
            const got = at(w);
            const off = got.reduce((m, v, i) => Math.max(m, Math.abs((1 - w) * main[i] + w * live[i] - v)), 0);
            assert.ok(off < 1e-5, `w ${w}, g ${g}, tile (${origin}): ${(off / LEVEL).toFixed(3)} levels off`);
          }
          const span = worstApart(main, live);
          for (const [a, b] of [[1, 1 - 1 / 60], [1 / 60, 0]]) {
            const step = worstApart(at(a), at(b));
            assert.ok(step <= span / 60 + 1e-5, `g ${g}, tile (${origin}): w ${a} to ${b} steps ${(step / LEVEL).toFixed(3)} levels, ${(span / 60 / LEVEL).toFixed(3)} at most`);
          }
          tile.free();
        }
      }
    });
  }

  test("a settled felt's crossed ends stay as close to the lit cloth at its lean as they are, and never drift further", () => {
    const MEAN_CEILING = 0.76;
    const WORST_CEILING = 2.73;
    let sum = 0;
    let n = 0;
    let worst = 0;
    for (const name of FELTS) {
      for (const g of DENSITIES) {
        for (const lean of [0.25, 0.5, 0.75]) {
          const origin = tiles(TARGET)[1];
          const tile = settledTile(FeltGradients[name], g, lean, origin, true, 0);
          const cross = floats(g, origin, tile.settled);
          const live = floats(g, origin, tile.hand(1));
          for (let i = 0; i < cross.length; i++) {
            if (i % 4 === 3) continue;
            const d = Math.abs(cross[i] - live[i]) / LEVEL;
            sum += d;
            n++;
            worst = Math.max(worst, d);
          }
          tile.free();
        }
      }
    }
    console.log(`crossed ends from the lit cloth: mean ${(sum / n).toFixed(3)}, worst ${worst.toFixed(3)} levels`);
    assert.ok(sum / n <= MEAN_CEILING, `mean ${(sum / n).toFixed(3)} levels, ceiling ${MEAN_CEILING}`);
    assert.ok(worst <= WORST_CEILING, `worst ${worst.toFixed(3)} levels, ceiling ${WORST_CEILING}`);
  });
});
