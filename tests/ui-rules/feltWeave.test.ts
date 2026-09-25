// tests/ui-rules/feltWeave.test.ts — the cloth and the rail are the Lantern Table mockup's own
// (#1257): the shader line for line, the twill's numbers, the rail's rings, and a CanvasKit that
// compiles the shader at the version Skia pins.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { CLOTH_BODY, CLOTH_SKSL, TWILL } from "../../components/table/feltShader.ts";
import { paintRail, RAIL, type RingPainter } from "../../components/table/rail.ts";
import { fixtureBlock, fixtureLine, runFixture } from "../helpers/lanternFixture.ts";
import { CANVASKIT_VERSION } from "../../lib/canvaskit.ts";

const require = createRequire(import.meta.url);

const MOCKUP_ONLY: [string, string][] = [
  ["void main(){\n vec2 p=uO+vec2(gl_FragCoord.x,uRes.y-gl_FragCoord.y)/uK;", "vec4 cloth(vec2 p){"],
  ["{gl_FragColor=vec4(0.);return;}", "{return vec4(0.);}"],
  ["float jac=uJacOn>.5?step(.5,texture2D(uJac,p/36.).r):0.;", "float jac=0.;"],
  ["gl_FragColor=vec4(col*inside,inside);}", "return vec4(col*inside,inside);}"],
];

function mockupBody(): string {
  const fs = fixtureBlock("const FS=`", "}`;").slice("const FS=`".length, -"`;".length);
  let body = fs.slice(fs.indexOf("vec3 stops("));
  for (const [from, to] of MOCKUP_ONLY) {
    assert.ok(body.includes(from), `the mockup's FS no longer has ${from}`);
    body = body.replace(from, to);
  }
  return body;
}

describe("the felt is the mockup's cloth", () => {
  test("the shader body is FS, line for line, less the jacquard and the canvas mapping", () => {
    const want = mockupBody().split("\n");
    const got = CLOTH_BODY.split("\n");
    want.forEach((line, i) => assert.equal(got[i], line, `line ${i + 1} of the cloth differs from FS`));
    assert.equal(got.length, want.length);
  });

  test("its parameters are TWILL's", () => {
    const { TWILL: mockup } = runFixture([fixtureLine("const TWILL=")]) as { TWILL: Record<string, number> };
    const { uJacOn, ...twill } = mockup;
    assert.equal(uJacOn, 0);
    assert.deepEqual({ ...TWILL }, twill);
  });

  test("CanvasKit compiles it, at the version @shopify/react-native-skia depends on", async () => {
    const skia = JSON.parse(fs.readFileSync(require.resolve("@shopify/react-native-skia/package.json"), "utf8"));
    assert.equal(CANVASKIT_VERSION, skia.dependencies["canvaskit-wasm"]);

    const init = require("canvaskit-wasm/bin/full/canvaskit.js");
    const ck = await init({ locateFile: (f: string) => require.resolve(`canvaskit-wasm/bin/full/${f}`) });
    const errors: string[] = [];
    const effect = ck.RuntimeEffect.Make(CLOTH_SKSL, (e: string) => errors.push(e));
    assert.ok(effect, `the cloth does not compile as SkSL: ${errors.join("\n")}`);
    const names = Array.from({ length: effect.getUniformCount() }, (_, i) => effect.getUniformName(i));
    for (const u of ["uLamp", "uK", "uLampH", "uFlare", "uS0", "uS4", ...Object.keys(TWILL)]) {
      assert.ok(names.includes(u), `${u} is not a uniform of the cloth`);
    }
    effect.delete();
  });
});

interface Stroke {
  d: number;
  width: number;
  colour: string;
  dash?: { intervals: number[]; phase: number };
}

function mockupRail(): Stroke[] {
  const strokes: Stroke[] = [];
  let d = NaN;
  let dash: number[] = [];
  const c = {
    lineWidth: 0,
    strokeStyle: "",
    lineDashOffset: 0,
    setTransform() {},
    beginPath() {},
    setLineDash(s: number[]) {
      dash = s;
    },
    stroke() {
      strokes.push({
        d,
        width: c.lineWidth,
        colour: c.strokeStyle,
        ...(dash.length ? { dash: { intervals: dash, phase: c.lineDashOffset } } : {}),
      });
    },
  };
  const ctx = runFixture(
    [fixtureLine("function rng("), fixtureLine("const hexRgb="), fixtureLine("const RAIL="), fixtureBlock("function buildRail", "return cv;}")],
    {
      V: { bg: { width: 1, height: 1 }, K: 2, railKey: "" },
      document: { createElement: () => ({ getContext: () => c }) },
      ringPath: (_: unknown, at: number) => (d = at),
    }
  );
  (ctx.buildRail as () => void)();
  return realm(strokes);
}

const realm = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

describe("the rail is the mockup's walnut and brass", () => {
  test("paintRail strokes the rings buildRail strokes, in order, from the same seed", () => {
    const ours: Stroke[] = [];
    const painter: RingPainter = { ring: (d, width, colour, dash) => ours.push({ d, width, colour, ...(dash ? { dash } : {}) }) };
    paintRail(painter);
    const theirs = mockupRail();
    assert.ok(theirs.length > 50, `the mockup's rail stroked ${theirs.length} rings`);
    assert.equal(ours.length, theirs.length);
    theirs.forEach((want, i) => {
      const got = ours[i];
      assert.ok(Math.abs(got.d - want.d) < 1e-9 && got.width === want.width, `ring ${i} at ${got.d}, not ${want.d}`);
      assert.equal(got.colour.replace(/\s/g, ""), want.colour.replace(/\s/g, ""), `ring ${i}'s colour`);
      assert.deepEqual(got.dash, want.dash, `ring ${i}'s grain`);
    });
  });

  test("the band is 13 pt of walnut and 1 pt of brass", () => {
    const { RAIL: mockup } = runFixture([fixtureLine("const RAIL=")]) as { RAIL: { w: number; c: unknown; grain?: number }[] };
    assert.deepEqual(
      [
        { k: "wood", ...RAIL.wood, c: [...RAIL.wood.c] },
        { k: "line", ...RAIL.line },
      ],
      realm(mockup)
    );
  });
});
