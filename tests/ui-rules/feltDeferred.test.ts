// tests/ui-rules/feltDeferred.test.ts — the felt bakes the cloth's lamp-free terms once per size
// and lights them each frame. Lit from 8-bit planes on CanvasKit's CPU raster, the cloth must
// match the one-pass shader to under one 8-bit level, wherever the lamp is.
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { CLOTH_SKSL, FELT_K_CAP, FLARE_SEEN, LIT_SKSL, REST_CLOTH_SKSL, REST_LIT_SKSL, WEAVE_PLANES, WEAVE_SKSL, clothUniforms, flareShare, weaveUniforms, type ClothUniforms } from "../../components/table/feltShader.ts";
import { TABLE_CENTRE, lampControls, lightUniforms, restingLamp, stepLamp } from "../../components/table/lampRig.ts";
import { FeltGradients } from "../../lib/tokens.ts";

const require = createRequire(import.meta.url);

/** Device pixels per design point: DPR 1, a DPR 2 phone, and the felt's cap. */
const DENSITIES = [1, 2, FELT_K_CAP];
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
const tiles = (lamp: [number, number]) => [[106, 46], [lamp[0] - TILE / 2, lamp[1] - TILE / 2]] as const;
/** The error is a share of the albedo: the felts brightest in green and in red. */
const FELTS = ["verde", "bordeaux"] as const;

const LEVEL = 1 / 255;

type CK = any;
let ck: CK;
let cloth: CK;
let weave: CK;
let lit: CK;
let restLit: CK;
let restCloth: CK;

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
  restLit = make(REST_LIT_SKSL, "the settled felt over the planes");
  restCloth = make(REST_CLOTH_SKSL, "the settled felt over the cloth");
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

/** The tile at `origin`, `TILE` points square, drawn at `k` device pixels a point. */
function draw(surface: CK, k: number, origin: readonly [number, number], shader: CK) {
  const canvas = surface.getCanvas();
  canvas.clear(ck.TRANSPARENT);
  canvas.save();
  canvas.scale(k, k);
  canvas.translate(-origin[0], -origin[1]);
  const paint = new ck.Paint();
  paint.setShader(shader);
  canvas.drawRect(ck.XYWHRect(origin[0], origin[1], TILE, TILE), paint);
  canvas.restore();
  surface.flush();
  paint.delete();
}

function floats(k: number, origin: readonly [number, number], shader: CK): Float32Array {
  const side = Math.round(TILE * k);
  const info = { width: side, height: side, colorType: ck.ColorType.RGBA_F32, alphaType: ck.AlphaType.Premul, colorSpace: ck.ColorSpace.SRGB };
  const mem = ck.Malloc(Float32Array, side * side * 4);
  const surface = ck.MakeRasterDirectSurface(info, mem, side * 16);
  draw(surface, k, origin, shader);
  const out = Float32Array.from(mem.toTypedArray());
  surface.delete();
  ck.Free(mem);
  return out;
}

/** The weave's planes for a tile, as the felt bakes them: an 8-bit surface each, read back nearest at the pixel they were baked on. */
function planes(k: number, origin: readonly [number, number]): CK[] {
  const side = Math.round(TILE * k);
  const place = ck.Matrix.multiply(ck.Matrix.translated(origin[0], origin[1]), ck.Matrix.scaled(1 / k, 1 / k));
  return Array.from({ length: WEAVE_PLANES }, (_, plane) => {
    const surface = ck.MakeSurface(side, side);
    const shader = weave.makeShader(flat(weave, weaveUniforms(k, plane)));
    draw(surface, k, origin, shader);
    const image = surface.makeImageSnapshot();
    const child = image.makeShaderOptions(ck.TileMode.Clamp, ck.TileMode.Clamp, ck.FilterMode.Nearest, ck.MipmapMode.None, place);
    shader.delete();
    surface.delete();
    image.delete();
    return child;
  });
}

interface Gap {
  worst: number;
  where: string;
  inside: number;
}

function gap(stops: readonly string[], k: number, lamp: [number, number], light: (typeof LIGHTS)[number], origin: readonly [number, number]): Gap {
  const values: ClothUniforms = { ...clothUniforms(stops as never, k), ...lightUniforms(light.reach), uLamp: lamp, uFlare: light.uFlare };
  const one = cloth.makeShader(flat(cloth, values));
  const children = planes(k, origin);
  const two = lit.makeShaderWithChildren(flat(lit, values), children);
  const want = floats(k, origin, one);
  const got = floats(k, origin, two);
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
  const side = Math.round(TILE * k);
  const where = `k ${k}, lamp (${lamp}), flare ${light.uFlare}, reach ${light.reach}, tile (${origin}) px (${px % side}, ${Math.floor(px / side)}) channel ${at % 4}: ${want[at]} want, ${got[at]} got`;
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

const SWAY_ENDS = [
  [0.2, 0.4, 0.6],
  [0.7, 0.15, 0.3],
] as const;

/** The settled felt at `w`, against `w` of its own cloth over the cross of two flat ends, both on the CPU raster in floats. */
function settledGap(stops: readonly string[], k: number, lamp: [number, number], w: number, over: boolean): number {
  const lean = 0.3;
  const values: ClothUniforms = { ...clothUniforms(stops as never, k), ...lightUniforms(1), uLamp: lamp, uFlare: 0.4, uLean: lean, uW: w };
  const origin = [lamp[0] - TILE / 2, lamp[1] - TILE / 2] as const;
  const ends = SWAY_ENDS.map(([r, g, b]) => ck.Shader.MakeColor(ck.Color4f(r, g, b, 1), ck.ColorSpace.SRGB));
  const weave = over ? planes(k, origin) : [];
  const own = over ? lit.makeShaderWithChildren(flat(lit, values), weave) : cloth.makeShader(flat(cloth, values));
  const settled = over ? restLit.makeShaderWithChildren(flat(restLit, values), [...weave, ...ends]) : restCloth.makeShaderWithChildren(flat(restCloth, values), ends);
  const want = floats(k, origin, own);
  const got = floats(k, origin, settled);
  [own, settled, ...weave, ...ends].forEach((s) => s.delete());
  const cross = SWAY_ENDS[0].map((a, i) => a + (SWAY_ENDS[1][i] - a) * lean).concat(1);
  let worst = 0;
  for (let i = 0; i < want.length; i++) worst = Math.max(worst, Math.abs(cross[i % 4] * (1 - w) + want[i] * w - got[i]));
  return worst;
}

describe("the felt lit from its baked weave is the cloth", () => {
  test("the lit pass reads the weave from its planes, not from the cloth's own noise", () => {
    assert.ok(LIT_SKSL.includes("uG0.eval(p)") && LIT_SKSL.includes(`uG${WEAVE_PLANES - 1}.eval(p)`), "the lit cloth reads no plane");
    assert.ok(!LIT_SKSL.includes("vn(vec2(tid*1.7"), "the lit cloth still draws the slub");
    assert.ok(!LIT_SKSL.includes("h21(floor(p*uK))"), "the lit cloth still draws the fuzz");
  });

  for (const [name, sksl] of [
    ["the lit pass", LIT_SKSL],
    ["the settled felt", REST_LIT_SKSL],
  ] as const) {
    test(`${name}: every term the lamp does not move is baked, so a lit pixel costs two reads and the lamp's own terms`, () => {
      assert.equal(WEAVE_PLANES, 2);
      const body = clothOf(sksl);
      assert.ok(body.includes("uG0.eval(p)") && body.includes("uG1.eval(p)"), `${name}'s cloth reads no plane: ${body}`);
      for (const term of ["prof", "tv", "mott", "vis", "uDepth", "uCover", "uFuzz", "uSheen", "uMott", "uTwo"]) {
        assert.ok(!new RegExp(`\\b${term}\\b`).test(body), `${name} still computes ${term} per pixel`);
      }
    });
  }

  for (const felt of FELTS) {
    const stops = FeltGradients[felt];
    test(`${felt}: under one 8-bit level from the one-pass cloth, at every density and lamp`, () => {
      let worst: Gap = { worst: 0, where: "nowhere", inside: 0 };
      let inside = 0;
      for (const k of DENSITIES) {
        for (const lamp of LAMPS) {
          for (const light of LIGHTS) {
            for (const origin of tiles(lamp)) {
              const g = gap(stops, k, lamp, light, origin);
              inside += g.inside;
              if (g.worst > worst.worst) worst = g;
            }
          }
        }
      }
      assert.ok(inside > 0, "no tile drew any felt");
      assert.ok(worst.worst < LEVEL, `${(worst.worst / LEVEL).toFixed(3)} levels apart at ${worst.where}`);
      console.log(`${felt}: worst ${(worst.worst / LEVEL).toFixed(3)} levels at ${worst.where}`);
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
    test(`the settled felt ${over ? "over the planes" : "over the cloth"} is the cross at 0, its own cloth at 1, and the line between them`, () => {
      for (const w of [0, 0.01, 0.3, 0.5, 0.99, 1]) {
        for (const k of DENSITIES) {
          const worst = settledGap(FeltGradients.verde, k, LAMPS[4], w, over);
          assert.ok(worst < 1e-5, `w ${w}, k ${k}: ${worst / LEVEL} levels off`);
        }
      }
    });
  }
});
