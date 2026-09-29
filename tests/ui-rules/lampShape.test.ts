// tests/ui-rules/lampShape.test.ts — the shipped cloth, rendered by CanvasKit round the seats every
// phone lays out, lights the seat on move above the rest, and every seat about the same (D1, Q3).
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { anchorPoints } from "../../components/flightPhysics.ts";
import type { FlyDirection } from "../../components/seatLayout.ts";
import { CLOTH_SKSL, clothUniforms, type ClothUniforms } from "../../components/table/feltShader.ts";
import { LIGHT_ABOVE, designScale, lampPools, lightUniforms } from "../../components/table/lampRig.ts";
import { ANNULUS_OUTER, feltOnly, legibilityRing } from "../../components/table/legibilityRing.ts";
import { ROOM } from "../../components/table/rail.ts";
import { LAMP_FLOOR, LAMP_SYMMETRY, annulusLuminance, evenness, legibility } from "../../lib/diagnostics/lampLegibility.ts";
import { FeltGradients } from "../../lib/tokens.ts";
import { PHONES } from "../e2e/helpers/phones.ts";
import { INSETS, phoneTable } from "../helpers/phoneTable.ts";

const require = createRequire(import.meta.url);

/** CanvasKit's CPU raster runs the cloth at about 100k px/s; at 3 px a point the sides read up to 0.15 brighter. */
const PER_PT = 1;
const SEATS: readonly FlyDirection[] = ["bottom", "right", "top", "left"];

type CanvasKit = any;
let ck: CanvasKit;
let cloth: any;

before(async () => {
  const init = require("canvaskit-wasm/bin/full/canvaskit.js");
  ck = await init({ locateFile: (f: string) => require.resolve(`canvaskit-wasm/bin/full/${f}`) });
  const errors: string[] = [];
  cloth = ck.RuntimeEffect.Make(CLOTH_SKSL, (e: string) => errors.push(e));
  assert.ok(cloth, `the cloth does not compile as SkSL: ${errors.join("\n")}`);
});

function packed(values: ClothUniforms): Float32Array {
  const names = Array.from({ length: cloth.getUniformCount() }, (_, i) => cloth.getUniformName(i) as string);
  for (const name of Object.keys(values)) assert.ok(names.includes(name), `${name} is not a uniform of the shipped cloth`);
  const floats = new Float32Array(cloth.getUniformFloatCount());
  names.forEach((name, i) => {
    const v = values[name];
    if (v === undefined) throw new Error(`no value for ${name}`);
    const { slot } = cloth.getUniform(i);
    if (typeof v === "number") floats[slot] = v;
    else floats.set(v, slot);
  });
  return floats;
}

type Point = { x: number; y: number };

/** The cloth round each seat over the room, with the lamp at rest over `onMove`; the rail is not drawn. */
function seatMeans(width: number, height: number, anchors: Record<FlyDirection, Point>, stops: readonly string[], onMove: FlyDirection) {
  const { sx, sy } = designScale(width, height);
  const [x, y, reach] = lampPools(anchors, width, height)[onMove];
  const floats = packed({
    ...clothUniforms(stops as never, PER_PT * Math.min(sx, sy)),
    uLamp: [x, y - LIGHT_ABOVE],
    uFlare: 0,
    ...lightUniforms(reach),
  });
  const surface = ck.MakeSurface(width * PER_PT, height * PER_PT);
  const canvas = surface.getCanvas();
  canvas.clear(ck.parseColorString(ROOM));
  canvas.scale(PER_PT * sx, PER_PT * sy);
  const shader = cloth.makeShader(floats);
  const paint = new ck.Paint();
  paint.setShader(shader);
  const r = ANNULUS_OUTER + 1;
  for (const a of Object.values(anchors)) canvas.drawOval(ck.XYWHRect(a.x / sx - r, a.y / sy - r, 2 * r, 2 * r), paint);
  const info = { width: width * PER_PT, height: height * PER_PT, colorType: ck.ColorType.RGBA_8888, alphaType: ck.AlphaType.Unpremul, colorSpace: ck.ColorSpace.SRGB };
  const data = canvas.readPixels(0, 0, info) as Uint8Array;
  paint.delete();
  shader.delete();
  surface.delete();
  const pixels = feltOnly({ width: info.width, height: info.height, data }, PER_PT);
  const ring = legibilityRing(width, height);
  return Object.fromEntries(SEATS.map((s) => [s, annulusLuminance(pixels, anchors[s], PER_PT, ring)])) as Record<FlyDirection, number>;
}

describe("the light round the seats, in the shipped SkSL", () => {
  for (const [felt, stops] of Object.entries(FeltGradients)) {
    test(`on ${felt}: the seat on move out-lights the rest, the same at every seat`, () => {
      const rows = PHONES.flatMap(({ name, width, height }) =>
        Object.entries(INSETS).map(([insets, edges]) => {
          const anchors = anchorPoints(phoneTable(width, height, edges));
          const ratios = SEATS.map((s) => legibility(seatMeans(width, height, anchors, stops, s), s));
          return { at: `${name} at ${insets}`, ratios, even: evenness(ratios) };
        })
      );
      const line = (r: (typeof rows)[number]) => `${r.at}: ${SEATS.map((s, i) => `${s} ${r.ratios[i].toFixed(2)}`).join(", ")}; evenness ${r.even.toFixed(2)}`;
      console.log(`${felt}\n  ${rows.map(line).join("\n  ")}`);
      for (const { at, ratios, even } of rows) {
        SEATS.forEach((s, i) => assert.ok(ratios[i] >= LAMP_FLOOR, `${at}: ${s} on move reads ${ratios[i].toFixed(2)}× the brightest other seat, under ${LAMP_FLOOR}`));
        assert.ok(even >= LAMP_SYMMETRY, `${at}: the worst seat ÷ the best is ${even.toFixed(2)}, under ${LAMP_SYMMETRY}`);
      }
    });
  }
});
