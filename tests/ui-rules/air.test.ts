// tests/ui-rules/air.test.ts — the table at rest (#1261): the motes and the moth draw what the
// mockup's own `lampStep` and `drawAir` draw, frame for frame, from the same random numbers.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { MOTES, createAir, moteAlpha, mothPose, moteAt, stepAir, type Air, type AirLight } from "../../components/table/air.ts";
import { fixtureBlock, fixtureLine, runFixture } from "../helpers/lanternFixture.ts";
import { mulberry32 } from "../engine/helpers.ts";

const DT = 1 / 60;

interface Ellipse {
  fill: string;
  x: number;
  y: number;
  rx: number;
  ry: number;
  rot: number;
}

interface MockupLamp {
  lx: number;
  ly: number;
  L: number;
  f: number;
  freeze: number;
  m: { x: number; y: number; r: number }[];
}

function mockup(seed: number) {
  const rng = mulberry32(seed);
  const drawn: Ellipse[] = [];
  let fill = "";
  const c = {
    set fillStyle(v: string) {
      fill = v;
    },
    beginPath() {},
    fill() {},
    arc: (x: number, y: number, r: number) => drawn.push({ fill, x, y, rx: r, ry: r, rot: 0 }),
    ellipse: (x: number, y: number, rx: number, ry: number, rot: number) => drawn.push({ fill, x, y, rx, ry, rot }),
  };
  const ctx = runFixture(
    [
      fixtureLine("const W=874"),
      fixtureLine("const clamp="),
      fixtureLine("const lamp={m:"),
      fixtureLine("function resetLamp"),
      fixtureBlock("function lampStep", "if(m.x>870)m.x=64;}}"),
      fixtureBlock("function drawAir", "c.fill();}}}}"),
    ],
    { simT: 0, R: (a: number, b: number) => a + rng() * (b - a) }
  );
  (ctx.resetLamp as () => void)();
  return {
    lamp: ctx.lamp as MockupLamp,
    frame(): Ellipse[] {
      ctx.simT = (ctx.simT as number) + DT;
      (ctx.lampStep as (dt: number) => void)(DT);
      drawn.length = 0;
      (ctx.drawAir as (c: unknown) => void)(c);
      return [...drawn];
    },
  };
}

function appDraws(air: Air, light: AirLight): Ellipse[] {
  const out: Ellipse[] = [];
  for (let i = 0; i < MOTES; i++) {
    const a = moteAlpha(air, i, light);
    const m = moteAt(air, i);
    if (a > 0) out.push({ fill: `rgba(255,228,170,${a.toFixed(3)})`, x: m.x, y: m.y, rx: m.r, ry: m.r, rot: 0 });
  }
  const moth = mothPose(air, light);
  if (moth) {
    out.push({ fill: "rgba(0,0,0,.28)", x: moth.sx, y: moth.sy, rx: moth.shadowRx, ry: moth.shadowRy, rot: moth.shadowRot });
    for (const side of [-1, 1]) out.push({ fill: "rgba(232,214,176,.9)", x: moth.mx + side * moth.wing, y: moth.my, rx: moth.wing, ry: moth.wingRy, rot: 0 });
  }
  return out;
}

const close = (a: number, b: number, what: string) => assert.ok(Math.abs(a - b) < 1e-6, `${what}: ${a} against ${b}`);

describe("the air at rest", () => {
  test("drifts, wraps, twinkles and sends the moth across as the mockup's lampStep and drawAir do", () => {
    const seed = 1261;
    const m = mockup(seed);
    const rng = mulberry32(seed);
    const air = createAir(rng);
    const FREEZES: [number, number][] = [[1200, 1], [1500, 0.5], [1800, 0]];
    let onsets = 0;
    let wrapped = 0;
    let lit = 0;
    let mothFrames = 0;
    for (let frame = 0; frame < 3600; frame++) {
      for (const [at, amount] of FREEZES) if (at === frame) m.lamp.freeze = amount;
      const before = air.m.slice();
      const expected = m.frame();
      const light = { lx: m.lamp.lx, ly: m.lamp.ly, level: m.lamp.L, f: m.lamp.f, r: 1, freeze: m.lamp.freeze };
      if (stepAir(air, DT, light.freeze, false, rng)) onsets++;
      wrapped += air.m.filter((v, i) => Math.abs(v - before[i]) > 100).length;
      const got = appDraws(air, light);
      assert.equal(got.length, expected.length, `frame ${frame}: ${got.length} shapes against ${expected.length}`);
      for (const [k, e] of expected.entries()) {
        const g = got[k];
        const what = `frame ${frame}, shape ${k}`;
        if (e.fill.startsWith("rgba(255,228,170,")) {
          lit++;
          assert.ok(Math.abs(parseFloat(g.fill.slice(17)) - parseFloat(e.fill.slice(17))) <= 0.0011, `${what}: ${g.fill} against ${e.fill}`);
        } else {
          assert.equal(g.fill, e.fill, what);
          mothFrames++;
        }
        for (const key of ["x", "y", "rx", "ry", "rot"] as const) close(g[key], e[key], `${what} ${key}`);
      }
    }
    assert.ok(onsets >= 3, `${onsets} moths in a minute`);
    assert.ok(wrapped >= 1, "no mote ever wrapped");
    assert.ok(lit > 3600 * 5, `${lit} lit motes over 3600 frames`);
    assert.ok(mothFrames > 3 * 4 * 60 * 3 * 0.9, `${mothFrames} moth shapes drawn`);
  });

  test("the first moth sets off 6 to 10 s in, and the next 10 to 15 s after the last set off", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const rng = mulberry32(seed);
      const air = createAir(rng);
      const sets: number[] = [];
      for (let frame = 0; frame < 60 * 60; frame++) if (stepAir(air, DT, 0, false, rng)) sets.push(air.t);
      assert.ok(sets[0] >= 6 && sets[0] <= 10 + DT, `seed ${seed}: first moth at ${sets[0]} s`);
      for (let i = 1; i < sets.length; i++) {
        const gap = sets[i] - sets[i - 1];
        assert.ok(gap >= 10 && gap <= 15 + DT, `seed ${seed}: moth ${i} ${gap} s after the last`);
      }
    }
  });

  test("the cone grows with the light's reach", () => {
    const air = createAir(mulberry32(3));
    air.m.set([400, 300, 1, 0, 0, Math.PI / 2], 0);
    const light = { lx: 100, ly: 300, level: 1, f: 0, r: 1, freeze: 0 };
    assert.equal(moteAlpha(air, 0, light), 0, "300 pt off, at reach 1");
    close(moteAlpha(air, 0, { ...light, r: 2 }), 0.5 * 0.85, "300 pt off, at reach 2");
    close(moteAlpha(air, 0, { ...light, f: 1 }), 0.4 * 0.85, "300 pt off, flared");
  });

  test("under reduced motion the motes hold still and lit, and no moth flies", () => {
    const rng = mulberry32(9);
    const air = createAir(rng);
    const start = Array.from({ length: MOTES }, (_, i) => moteAt(air, i));
    const light = { lx: 437, ly: 161, level: 1, f: 0, r: 1, freeze: 0 };
    const alphas = start.map((_, i) => moteAlpha(air, i, light));
    for (let frame = 0; frame < 30 * 60; frame++) assert.equal(stepAir(air, DT, 0, true, rng), false, "a moth set off");
    assert.equal(mothPose(air, light), null);
    for (let i = 0; i < MOTES; i++) {
      assert.deepEqual(moteAt(air, i), start[i], `mote ${i} moved`);
      assert.equal(moteAlpha(air, i, light), alphas[i], `mote ${i} twinkled`);
    }
    assert.ok(alphas.filter((a) => a > 0).length >= 10, "the cone lights some motes");
  });
});
