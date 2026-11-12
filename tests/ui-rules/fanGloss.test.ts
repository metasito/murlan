// tests/ui-rules/fanGloss.test.ts — the gloss of a fan at rest is the Lantern Table's `gloss()` at every moment of the sway, from the
// felt's own baked sway (`restEnds.endTrack`) and held to the rig the felt's way (`restEnds.steering`).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { lampControls, MAX_DT, restingLamp, stepLamp, SWAY, type Lamp } from "../../components/table/lampRig.ts";
import { cardGloss, GLOSS_POINT_STEP, glossSpot, type GlossLight } from "../../components/table/cardGloss.ts";
import { createGlossTracks } from "../../components/table/glossTrackStore.ts";
import { fadeA, spotPose, spotSlide, streakPose } from "../../components/table/fanTrack.ts";
import { SPOT_STOPS } from "../../components/table/glossStops.ts";
import { DRIFT_CHECK_MS, DRIFT_PT, driftPt, endLamp, endTrack, isRested, leanOf, placeOf, restLight, steering, type EndTrack } from "../../components/table/restEnds.ts";
import { TRACK_SECONDS } from "../../lib/swayTable.ts";
import { fixtureLine, runFixture } from "../helpers/lanternFixture.ts";

const FRAME = 1 / 60;
const S = 1.4;
const BACK = { placed: { x: 420, y: 70, rot: 12 }, box: { w: 40, h: 58 } };

type Frames = Record<string, Record<string, unknown>>;

/** A keyframe set read the way CSS reads it: linear between the stops that bracket `seconds`, held after the last. */
function valueAt(keyframes: Frames, duration: number, seconds: number, read: (frame: Record<string, unknown>) => number): number {
  const stops = Object.entries(keyframes)
    .map(([k, v]) => [(parseFloat(k) / 100) * duration, read(v)] as const)
    .sort((a, b) => a[0] - b[0]);
  const t = seconds * 1000;
  if (t >= stops[stops.length - 1]![0]) return stops[stops.length - 1]![1];
  const i = stops.findIndex(([at]) => at > t);
  const [t0, v0] = stops[i - 1]!;
  const [t1, v1] = stops[i]!;
  return v0 + ((v1 - v0) * (t - t0)) / (t1 - t0);
}

/** A lamp at rest at `t` and `ph`, stepped frame by frame: what the track must equal. */
const resting = (t = 12.5, ph = 1.1): Lamp => Object.assign(restingLamp([437, 180, 1]), { t, ph });
const bakedFrom = (s: Lamp): EndTrack => endTrack(s.ph, s.t);

function after(s: Lamp, frames: number): Lamp {
  const run = structuredClone(s);
  stepLamp(run, 0, false);
  for (let n = 0; n < frames; n++) stepLamp(run, FRAME, false);
  return run;
}

/** The spot as the compositor draws it: its pose at the centre of the sway and the slide, a card turned 0 so the slide is in the card's own axes. */
function slid(track: EndTrack, s: Lamp, sec: number) {
  const pose = spotPose(endLamp(s, 0), BACK.placed, BACK.box);
  const slide = spotSlide(track.sway, { a: spotPose(endLamp(s, -SWAY), BACK.placed, BACK.box), b: spotPose(endLamp(s, SWAY), BACK.placed, BACK.box), centre: pose }, S, 0);
  const dx = valueAt(slide as Frames, track.duration, sec, (f) => (f.transform as Record<string, number>[]).find((m) => "translateX" in m)!.translateX!);
  return { x: pose.x + dx / S, y: pose.y, alpha: pose.alpha };
}

/** A spot's brightness at `r` from its centre, as its gradient paints it, at full alpha. */
function profile(r: number): number {
  const at = r / 85;
  const i = SPOT_STOPS.findIndex((s) => s.at >= at);
  if (i <= 0) return SPOT_STOPS[0].alpha;
  const [a, b] = [SPOT_STOPS[i - 1]!, SPOT_STOPS[i]!];
  return a.alpha + ((b.alpha - a.alpha) * (at - a.at)) / (b.at - a.at);
}

describe("the spot slides along the lamp's sway, as the mockup's one spot", () => {
  test("to within half a point of glossSpot, along the sway", () => {
    const start = resting();
    const track = bakedFrom(start);
    const { w, h } = BACK.box;
    for (const at of [0, 0.37, 1.5, 4.3, 11, 20, 27]) {
      const sec = Math.round(at / FRAME) * FRAME;
      const live = after(start, Math.round(sec / FRAME));
      const want = glossSpot(BACK.placed.x, BACK.placed.y, w, h, live);
      const got = slid(track, start, sec);
      assert.ok(Math.abs(got.x - want.spot.x) < 0.5, `x at ${sec}s: ${got.x} against ${want.spot.x}`);
      assert.ok(Math.abs(got.y - want.spot.y) < 0.5, `y at ${sec}s`);
      assert.ok(Math.abs(got.alpha - want.spotAlpha) < 0.004, `alpha at ${sec}s`);
    }
  });

  test("a crossfade of the two ends, 40 points apart, would dim the core at mid-sway to under 60%: the reason it slides", () => {
    const core = 1 - (1 - 0.5 * profile(SWAY)) ** 2;
    assert.ok(core < 0.6, `a crossfade would leave ${core} of the spot's peak`);
    assert.equal(profile(0), 1);
  });

  describe("against the mockup's own gloss()", () => {
    const LOOP = "  for(const[c,cx,cy]of list){";
    const perCard = fixtureLine(LOOP).slice(LOOP.length);
    const streak = fixtureLine("    const ang=").trim();
    const paint = fixtureLine("    c._gl.style.background=");
    const [, sx, sy] = /circle \d+px at \$\{\((.+?)\)\.toFixed\(1\)\}px \$\{\((.+?)\)\.toFixed\(1\)\}px/.exec(paint)!;

    test("is within a point along the sway at rest", () => {
      const start = resting();
      const track = bakedFrom(start);
      for (const at of [0, 0.25, 0.9, 2, 3.5, 8]) {
        const sec = Math.round(at / FRAME) * FRAME;
        const lamp = after(start, Math.round(sec / FRAME));
        const got = runFixture([fixtureLine("const clamp="), perCard, streak, `var spotX=${sx},spotY=${sy};`], {
          c: { _w: BACK.box.w, _h: BACK.box.h },
          cx: BACK.placed.x,
          cy: BACK.placed.y,
          lx: lamp.lx,
          ly: lamp.ly,
          lamp: { L: lamp.level },
        }) as Record<string, number>;
        const { x, y } = slid(track, start, sec);
        assert.ok(Math.abs(x - got.spotX!) <= 1, `x at ${sec}s: ${x} against the mockup's ${got.spotX}`);
        assert.ok(Math.abs(y - got.spotY!) <= 1, `y at ${sec}s: ${y} against the mockup's ${got.spotY}`);
      }
    });
  });
});

describe("the streak pair", () => {
  test("the fades are the felt's lean, and sum to one", () => {
    const start = resting();
    const track = bakedFrom(start);
    const a = fadeA(track.sway) as Frames;
    for (let n = 0; n < 1800; n += 37) {
      const sec = n * FRAME;
      const live = after(start, n);
      const b = valueAt(track.keyframes as Frames, track.duration, sec, (f) => f.opacity as number);
      assert.ok(Math.abs(b - leanOf(live)) < 0.01, `end B is the lean at ${sec}s`);
      assert.ok(Math.abs(valueAt(a, track.duration, sec, (f) => f.opacity as number) + b - 1) < 1e-9);
    }
  });

  test("crossfaded, draws a band within a quarter of the exact one's half-width, and at 85% of its brightness, along a sway", () => {
    const start = resting();
    const track = bakedFrom(start);
    const ends = streakPose([endLamp(start, -SWAY), endLamp(start, SWAY)], BACK.placed, BACK.box);
    let place = 0;
    let bright = 1;
    for (let n = 0; n < 1800; n += 22) {
      const sec = n * FRAME;
      const live = after(start, n);
      const exact = cardGloss(BACK.placed.x, BACK.placed.y, BACK.box.w, BACK.box.h, live);
      const fadeB = valueAt(track.keyframes as Frames, track.duration, sec, (f) => f.opacity as number);
      // Rendered: both bands over a line across the exact band's axis, each at its own fade, as the compositor lays them.
      const axis = [Math.sin(exact.ang), -Math.cos(exact.ang)] as const;
      const centre = (e: { x: number; y: number }) => e.x * axis[0] + e.y * axis[1];
      const alphaAt = (u: number) => {
        const one = (e: { x: number; y: number; opacity: number }, share: number) => share * e.opacity * Math.max(0, 1 - Math.abs(u - centre(e)) / exact.band.half);
        return 1 - (1 - one(ends[0], 1 - fadeB)) * (1 - one(ends[1], fadeB));
      };
      let peak = 0;
      let at = 0;
      for (let u = -4 * exact.band.half; u <= 4 * exact.band.half + 260; u += exact.band.half / 20) {
        const a = alphaAt(centre({ x: exact.band.x, y: exact.band.y }) + u);
        if (a > peak) [peak, at] = [a, u];
      }
      place = Math.max(place, Math.abs(at) / exact.band.half);
      bright = Math.min(bright, peak / exact.a);
    }
    assert.ok(place < 0.25, `the drawn peak is ${place} half-widths off`);
    assert.ok(bright > 0.85, `the drawn peak is ${bright} of the exact one`);
  });
});

describe("the gloss is the felt's while the lamp rests", () => {
  test("a glide, a kick and a dim are not rested, and the settled lamp is", () => {
    const s = restingLamp([200, 300, 1]);
    assert.equal(isRested(s), true);
    lampControls.setTarget(s, [700, 120, 1.3], false);
    assert.equal(isRested(s), false, "gliding");
    for (let n = 0; n < 60 * 25; n++) stepLamp(s, FRAME, false);
    assert.equal(isRested(s), true, "settled");
    lampControls.kick(s, false);
    assert.equal(isRested(s), false, "kicked");
    const dim = restingLamp([437, 180, 1]);
    lampControls.hold(dim, "lost", 0.4, 3);
    stepLamp(dim, FRAME, false);
    assert.equal(isRested(dim), false, "dimming");
  });

  test("the backs stop posing their gloss once a glide is within the step a gloss shows, before the felt rests", () => {
    const s = restingLamp([200, 300, 1]);
    const value = <T,>(v: T) => ({ value: v, get: () => v }) as never;
    const light = value(restLight(s)) as { value: GlossLight };
    const tracks = createGlossTracks({ now: () => s, clock: () => s.t }, { rest: value(restLight(s)), light: light as never, ends: value(0) }, s);
    lampControls.setTarget(s, [700, 120, 1], false);
    let posesUnderStep = 0;
    let felt = 0;
    for (let n = 0; n < 60 * 25 && !isRested(s); n++) {
      stepLamp(s, FRAME, false);
      const shown = light.value;
      tracks.follow(s);
      const under = Math.abs(s.x - s.tx) < GLOSS_POINT_STEP && Math.abs(s.y - s.ty) < GLOSS_POINT_STEP;
      if (under && light.value !== shown) posesUnderStep += 1;
      if (under) felt += 1;
      if (!under) assert.equal(tracks.live(), true, "gliding further than a step is drawn by the backs");
    }
    assert.equal(isRested(s), true, "the felt rests");
    assert.ok(felt > 30, `the glide spends ${felt} frames under a step before the felt rests`);
    assert.equal(tracks.live(), false, "the fans draw the gloss at rest");
    assert.equal(posesUnderStep, 0, "no back is posed for a glide no gloss shows");
    lampControls.kick(s, false);
    tracks.follow(s);
    assert.equal(tracks.live(), true, "a kick is drawn by the backs");
  });

  test("a rested lamp sent under a step away is taken anew there, once", () => {
    const s = restingLamp([200, 300, 1]);
    const value = <T,>(v: T) => ({ value: v, get: () => v }) as never;
    const rest = value(restLight(s)) as { value: GlossLight };
    const tracks = createGlossTracks({ now: () => s, clock: () => s.t }, { rest: rest as never, light: value(restLight(s)), ends: value(0) }, s);
    let taken = 0;
    tracks.subscribe(() => void (taken += 1));
    lampControls.setTarget(s, [201.5, 300, 1], false);
    tracks.follow(s);
    assert.equal(tracks.live(), false, "a glide under a step is still drawn by the fans");
    assert.equal(tracks.get().tx, 201.5, "the fans bake at the new target");
    assert.deepEqual(rest.value, restLight(s), "the foil reads the new rest");
    for (let n = 0; n < 60 * 10; n++) {
      stepLamp(s, FRAME, false);
      tracks.follow(s);
    }
    assert.equal(taken, 1, "taken once for the move, not every frame of it");
  });

  test("the step the gloss holds still for is no more than the 2 pt the fan glide spec checks", () => {
    assert.ok(GLOSS_POINT_STEP <= 2);
  });

  test("where the lamp comes to rest, the ends are the sway's two extremes", () => {
    const s = restingLamp([437, 180, 1]);
    assert.equal(endLamp(s, SWAY).lx - endLamp(s, -SWAY).lx, 2 * SWAY);
    assert.equal(endLamp(s, 0).lean, 0.5);
  });
});

describe("held to the rig through stalls", () => {
  /** Wall-clock frames of `ms`: the rig steps at most MAX_DT a frame, the track keeps the wall's clock; the felt's checks run every DRIFT_CHECK_MS. */
  function run(ms: number, seconds: number) {
    const start = resting();
    let track = endTrack(start.ph, start.t);
    let rig = start.t;
    let playing = 0;
    let worst = 0;
    let rebakes = 0;
    let sinceCheck = 0;
    for (let wall = 0; wall < seconds * 1000; wall += ms) {
      playing += ms / 1000;
      rig += Math.min(MAX_DT, ms / 1000);
      sinceCheck += ms;
      if (playing > track.duration / 1000) playing -= track.duration / 1000;
      if (sinceCheck >= DRIFT_CHECK_MS) {
        sinceCheck = 0;
        const next = steering(track, playing, rig);
        if (next.kind === "rebake") {
          rebakes += 1;
          track = endTrack(start.ph, rig);
          playing = 0;
        } else if (next.kind === "steer") playing = next.place;
      }
      worst = Math.max(worst, driftPt(track.sway, playing, placeOf(track, rig)));
    }
    return { worst, rebakes };
  }

  test("frames of 16 to 800 ms leave the light within what a check interval of a stopped rig can drift", () => {
    for (const ms of [16, 100, 400, 800]) {
      const { worst } = run(ms, 60);
      assert.ok(worst <= DRIFT_PT + 1.01 * SWAY * (DRIFT_CHECK_MS / 1000), `${ms} ms frames: ${worst} pt off`);
    }
  });

  test("a track that runs out is baked anew before it wraps", () => {
    const { rebakes } = run(16, TRACK_SECONDS * 2);
    assert.ok(rebakes >= 1, "no rebake in two tracks' time");
  });
});
