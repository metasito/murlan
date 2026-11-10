// tests/ui-rules/moteTracks.test.ts — the motes' and the moth's tracks against the mockup's own `lampStep` and `drawAir`.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { MOTES, createAir, type Air } from "../../components/table/air.ts";
import { advanceAir, buildFlight, buildMoteTracks, buildMoth, mothAt, mothKeyframes, FLIGHT_S, litAt, SPAN_S, stillAlphas, trackAlpha, moteKeyframes, type MoteTrack, type MoteTracks, type RestLight } from "../../components/table/moteTracks.ts";
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

/** Where the track puts the mote `s` seconds in: linear between its stops. */
function trackAt(track: MoteTrack, s: number): { x: number; y: number } {
  const stops = track.drift;
  let k = 0;
  while (k < stops.length - 2 && stops[k + 1].t <= s) k++;
  const [a, b] = [stops[k], stops[k + 1]];
  const u = b.t > a.t ? Math.min(1, Math.max(0, (s - a.t) / (b.t - a.t))) : 0;
  return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
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
  const AT = [0.5, 1, 7.3, 20, 33.3, 45.9, 58, 59.9];
  test("every mote's alpha is within 0.05 of drawAir's over a whole span", () => {
    assert.ok(worstAlpha(1261, 0, AT) <= ALPHA_WITHIN);
    assert.ok(worstAlpha(4242, 0, AT) <= ALPHA_WITHIN);
  });
  test("a track rebuilt mid-way, from the air advanced to then, still is", () => {
    assert.ok(worstAlpha(1261, 37.25, [0.5, 3, 20, SPAN_S - 1]) <= ALPHA_WITHIN);
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
    for (let n = 1; n <= (SPAN_S - 1) * 60; n++) {
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
    assert.ok(SPAN_S >= 30);
  });
  test("one keyframe set per mote, as the compositor interpolates it, is within 0.05 of drawAir and 0.5 pt of the mockup's place", () => {
    const m = mockup(1261);
    const air = createAir(mulberry32(1261));
    const tracks = buildMoteTracks(air, LIGHT);
    const sets = tracks.motes.map((tr) => {
      const kf = moteKeyframes(tracks, tr) as unknown as Record<string, { opacity: number; transform: { translateX: number; translateY: number }[] }>;
      return { i: tr.i, r: tr.r, stops: Object.entries(kf).map(([k, v]) => ({ t: (parseFloat(k) / 100) * SPAN_S, o: v.opacity, x: v.transform[0].translateX, y: v.transform[1].translateY })).sort((a, b) => a.t - b.t) };
    });
    assert.ok(Math.max(...sets.map((s) => s.stops.length)) < 700, "a set grows with the span, not past it");
    let worstA = 0;
    let worstP = 0;
    const times = new Set([1.5, 7.3, 20.2, 33.3, 45.9, 58.2].map((s) => Math.round(s / DT)));
    for (let n = 1; n <= Math.max(...times); n++) {
      const drawn = m.frame();
      if (!times.has(n)) continue;
      const s = n * DT;
      for (const { i, r, stops } of sets) {
        let k = 0;
        while (k < stops.length - 2 && stops[k + 1].t <= s) k++;
        const [a, b] = [stops[k], stops[k + 1]];
        const u = b.t > a.t ? Math.min(1, Math.max(0, (s - a.t) / (b.t - a.t))) : 0;
        const o = a.o + (b.o - a.o) * u;
        const at = m.lamp.m[i];
        const hit = drawn.find((d) => d.x === at.x && d.y === at.y);
        worstA = Math.max(worstA, Math.abs(o - (hit?.alpha ?? 0)));
        const x = a.x + (b.x - a.x) * u + r;
        const y = a.y + (b.y - a.y) * u + r;
        if (Math.abs(x - at.x) < 100 && Math.abs(y - at.y) < 100) worstP = Math.max(worstP, Math.hypot(x - at.x, y - at.y));
      }
    }
    assert.ok(worstA <= ALPHA_WITHIN, `${worstA} off drawAir`);
    assert.ok(worstP < 0.5, `${worstP} pt`);
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
      const p = mothAt([{ s: 0, stops }], Math.min(FLIGHT_S, b.s))!;
      worst = Math.max(worst, Math.hypot(p.mx - b.x, p.my - b.y));
    }
    assert.ok(worst < 1.5, `${worst} pt off the mockup's moth`);
  });

  test("the moth is scheduled 6 to 10 s in, then 10 to 15 s apart, hidden between flights", () => {
    const rng = mulberry32(5);
    const { flights, next } = buildMoth(LIGHT, 0, 8, rng);
    assert.equal(flights[0].s, 8);
    for (let i = 1; i < flights.length; i++) {
      const gap = flights[i].s - flights[i - 1].s;
      assert.ok(gap >= 10 && gap <= 15, `gap ${gap}`);
    }
    assert.ok(next >= SPAN_S - FLIGHT_S);
    assert.equal(mothAt(flights, 4), null);
    assert.ok(mothAt(flights, 10));
    assert.equal(mothAt(flights, 13), null);
    const kf = mothKeyframes(flights, "body") as Record<string, { opacity: number }>;
    assert.equal(Object.values(kf).filter((k) => k.opacity === 1).length, flights.length * flights[0].stops.length);
  });

  test("the wings beat at the mockup's 38 rad/s over 3 to 7 pt, and the shadow breathes at 40 rad/s over 16 to 25", () => {
    const { stops } = buildMoth(LIGHT, 0, 8, mulberry32(3)).flights[0];
    const peaks = (v: number[]) => v.filter((x, i) => i > 0 && i < v.length - 1 && x > v[i - 1] && x >= v[i + 1]).length;
    const wing = stops.map((s) => s.wing * 7);
    const spread = stops.map((s) => s.spread * 25);
    assert.ok(Math.min(...wing) < 3.3 && Math.max(...wing) <= 7 && Math.max(...wing) > 6.5, `${Math.min(...wing)} to ${Math.max(...wing)}`);
    assert.ok(Math.min(...spread) < 16.8 && Math.max(...spread) <= 25 && Math.max(...spread) > 24, `${Math.min(...spread)} to ${Math.max(...spread)}`);
    assert.ok(Math.abs(peaks(wing) - (FLIGHT_S * 38) / Math.PI) <= 3, `${peaks(wing)} beats`);
    assert.ok(Math.abs(peaks(spread) - (FLIGHT_S * 40) / Math.PI) <= 3, `${peaks(spread)} breaths`);
  });
});
