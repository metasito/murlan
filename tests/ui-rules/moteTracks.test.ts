// tests/ui-rules/moteTracks.test.ts — the motes' and the moth's tracks against the mockup's own `lampStep` and `drawAir`.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { MOTES, createAir, type Air } from "../../components/table/air.ts";
import { advanceAir, buildFlight, buildMoteTracks, flightAt, FLIGHT_S, litAt, REBUILD_S, SPAN_S, stillAlphas, trackAlpha, trackAt, TWINKLE_KEYFRAMES, TWINKLE_MS, twinkleDelay, type MoteTracks, type RestLight } from "../../components/table/moteTracks.ts";
import { swayTimeOf, SWAY_REST_AT } from "../../lib/swayTable.ts";
import { fixtureBlock, fixtureLine, runFixture } from "../helpers/lanternFixture.ts";
import { mulberry32 } from "../support/game.ts";

const DT = 1 / 60;
const ALPHA_WITHIN = 0.05;

interface Drawn {
  alpha: number;
  x: number;
  y: number;
  rx: number;
  ry: number;
}

function mockup(seed: number) {
  const rng = mulberry32(seed);
  const drawn: Drawn[] = [];
  let fill = "";
  const c = {
    set fillStyle(v: string) {
      fill = v;
    },
    beginPath() {},
    fill() {},
    arc: (x: number, y: number, r: number) => drawn.push({ alpha: Number(/,([\d.]+)\)$/.exec(fill)![1]), x, y, rx: r, ry: r }),
    ellipse: (x: number, y: number, rx: number, ry: number) => drawn.push({ alpha: 1, x, y, rx, ry }),
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
  const lamp = ctx.lamp as { ph: number; m: { x: number; y: number }[] };
  return {
    lamp,
    frame(): Drawn[] {
      ctx.simT = (ctx.simT as number) + DT;
      (ctx.lampStep as (dt: number) => void)(DT);
      drawn.length = 0;
      (ctx.drawAir as (c: unknown) => void)(c);
      return [...drawn];
    },
    time: () => ctx.simT as number,
  };
}

const LIGHT: RestLight = { x: 437, ly: 292 - 40, level: 1, r: 1, tt: SWAY_REST_AT };

/** The worst a mote's alpha track is off `drawAir`, over every mote at each of `at` seconds, with the build at `from`. */
function worstAlpha(seed: number, from: number, at: number[], plant?: (t: MoteTracks) => void): number {
  const m = mockup(seed);
  const air: Air = createAir(mulberry32(seed));
  advanceAir(air, from);
  for (let n = 0; n < Math.round(from / DT); n++) m.frame();
  const tracks = buildMoteTracks(air, { ...LIGHT, tt: swayTimeOf(m.lamp.ph) });
  plant?.(tracks);
  const byMote = new Map(tracks.motes.map((t) => [t.i, t]));
  let worst = 0;
  const steps = new Set(at.map((s) => Math.round((from + s) / DT)));
  const last = Math.max(...steps);
  for (let n = Math.round(from / DT) + 1; n <= last; n++) {
    const drawn = m.frame();
    if (!steps.has(n)) continue;
    const s = n * DT - from;
    for (let i = 0; i < MOTES; i++) {
      const at = m.lamp.m[i];
      const hit = drawn.find((d) => d.x === at.x && d.y === at.y);
      const track = byMote.get(i);
      const got = track ? trackAlpha(tracks, track, s) : 0;
      const want = hit?.alpha ?? 0;
      worst = Math.max(worst, Math.abs(got - want));
    }
  }
  return worst;
}

describe("the mote tracks against drawAir", () => {
  const AT = [0.5, 1, 7.3, 20, 45.9, 90, 133.3, 200, 280, 294];
  test("every mote's alpha is within 0.05 of drawAir's over a whole span", () => {
    assert.ok(worstAlpha(1261, 0, AT) <= ALPHA_WITHIN);
    assert.ok(worstAlpha(4242, 0, AT) <= ALPHA_WITHIN);
  });
  test("a track rebuilt mid-way, from the air advanced to then, still is", () => {
    assert.ok(worstAlpha(1261, 37.25, [0.5, 3, 40, 150, REBUILD_S]) <= ALPHA_WITHIN);
  });
  test("a track whose cone is read at the wrong height is red", () => {
    const worst = worstAlpha(1261, 0, AT, (t) => {
      for (const m of t.motes) m.cone = m.cone.map((c, k) => ({ t: c.t, v: c.v * (k % 2 ? 0.8 : 1.2) }));
    });
    assert.ok(worst > ALPHA_WITHIN, `planted defect only ${worst} off`);
  });
  test("a mote's drift stays within 0.5 pt of the mockup's, wraps included", () => {
    const m = mockup(1261);
    const air = createAir(mulberry32(1261));
    const tracks = buildMoteTracks(air, LIGHT);
    let worst = 0;
    for (let n = 1; n <= 200 * 60; n++) {
      m.frame();
      if (n % 97) continue;
      const s = n * DT;
      for (const t of tracks.motes) {
        const p = trackAt(t, s);
        const at = m.lamp.m[t.i];
        if (Math.abs(p.x - at.x) > 100 || Math.abs(p.y - at.y) > 100) continue;
        worst = Math.max(worst, Math.hypot(p.x - at.x, p.y - at.y));
      }
    }
    assert.ok(worst < 0.5, `${worst} pt`);
  });
  test("some motes are lit, and the motes the light never reaches have no track", () => {
    const tracks = buildMoteTracks(createAir(mulberry32(1261)), LIGHT);
    assert.ok(litAt(tracks, 0) > 5);
    assert.ok(tracks.motes.length <= MOTES);
    assert.ok(SPAN_S > 290);
  });
  test("the shared twinkle starts each mote at its own phase", () => {
    assert.equal(Object.keys(TWINKLE_KEYFRAMES).length, 25);
    assert.ok(Math.abs(TWINKLE_MS - 4833) < 1);
    assert.ok(twinkleDelay(Math.PI) < 0);
  });
  test("under reduced motion the same motes are lit, still", () => {
    const air = createAir(mulberry32(1261));
    assert.ok(stillAlphas(air, LIGHT).filter((a) => a > 0.017).length > 5);
  });
});

describe("the moth's flight against drawAir", () => {
  test("follows the mockup's body, 4 s from its onset, the light swaying under it", () => {
    const m = mockup(7);
    let onset = -1;
    let phase = 0;
    const body: { s: number; x: number; y: number }[] = [];
    for (let n = 1; n < 60 * 40 && (onset < 0 || body.length < 60 * FLIGHT_S - 2); n++) {
      const drawn = m.frame();
      const wings = drawn.filter((d) => d.alpha === 1 && d.ry === 2);
      if (wings.length === 2) {
        if (onset < 0) {
          onset = m.time();
          phase = m.lamp.ph - (m.lamp.ph - phase) * 0;
        }
        body.push({ s: m.time() - onset, x: (wings[0].x + wings[1].x) / 2, y: wings[0].y });
      } else if (onset < 0) phase = m.lamp.ph;
    }
    assert.ok(onset > 0, "the mockup sent no moth");
    const stops = buildFlight({ x: 437, ly: 252, tt: swayTimeOf(phase) });
    let worst = 0;
    for (const b of body) {
      const p = flightAt(stops, Math.min(FLIGHT_S, b.s));
      worst = Math.max(worst, Math.hypot(p.mx - b.x, p.my - b.y));
    }
    assert.ok(worst < 1.5, `${worst} pt off the mockup's moth`);
  });
});
