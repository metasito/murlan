// tests/ui-rules/glossTrack.test.ts — an opponent's back is lit by a keyframe track the compositor plays,
// and the track is the Lantern Table's `gloss()` at every moment of it (rest-design PR E).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { GLIDE, lampControls, restingLamp, stepLamp, type Lamp } from "../../components/table/lampRig.ts";
import { cardGloss, glossSpot } from "../../components/table/cardGloss.ts";
import { SPOT_STOPS } from "../../components/table/glossStops.ts";
import { glossLive, GLOSS_HORIZON_S, nextGlossBake, snapOf, type LampSnap } from "../../components/table/glossTrack.ts";
import { bakeGlossTrack, crossAt, sharedTrack, spotPose, spotTrack, streakPose, swayAmplitude, type GlossTrack } from "../../components/table/fanTrack.ts";
import { fixtureLine, runFixture } from "../helpers/lanternFixture.ts";

const FRAME = 1 / 60;
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

/** The rig itself, stepped frame by frame from `snap`: what the track must equal. */
function rigFrom(snap: LampSnap): Lamp {
  const s = restingLamp([snap.x, snap.y + 40, snap.r]);
  return Object.assign(s, snap, { lx: snap.x, ly: snap.y });
}

function rigAfter(snap: LampSnap, frames: number): Lamp {
  const s = rigFrom(snap);
  for (let n = 0; n <= frames; n++) stepLamp(s, n === 0 ? 0 : FRAME, snap.reduced);
  return s;
}

const gliding = (): LampSnap => {
  const s = restingLamp([200, 300, 1]);
  lampControls.setTarget(s, [700, 120, 1.3], false);
  lampControls.kick(s, false);
  lampControls.hold(s, "lost", 0.4, 3);
  s.t = 12.5;
  s.ph = 1.1;
  return snapOf(s, false);
};

const track = (snap: LampSnap): GlossTrack => bakeGlossTrack(snap, 0);

const S = 1.4;

/** The spot as the compositor draws it: its pose at rest and the slide the track plays, read the way CSS reads them (a card turned `rot`: 0 here, so the slide is in the card's own axes). */
function slid(t: GlossTrack, sec: number) {
  const pose = spotPose(t, BACK.placed, BACK.box);
  const slide = spotTrack(t, S, 0)!;
  const dx = valueAt(slide.keyframes as Frames, slide.duration, sec, (f) => (f.transform as Record<string, number>[]).find((m) => "translateX" in m)!.translateX!);
  const dy = valueAt(slide.keyframes as Frames, slide.duration, sec, (f) => (f.transform as Record<string, number>[]).find((m) => "translateY" in m)!.translateY!);
  return { x: pose.x + dx / S, y: pose.y + dy / S, alpha: pose.alpha };
}

/** A spot's brightness at `r` from its centre, as its gradient paints it, at full alpha. */
function profile(r: number): number {
  const at = r / 85;
  const i = SPOT_STOPS.findIndex((s) => s.at >= at);
  if (i <= 0) return SPOT_STOPS[0].alpha;
  const [a, b] = [SPOT_STOPS[i - 1]!, SPOT_STOPS[i]!];
  return a.alpha + ((b.alpha - a.alpha) * (at - a.at)) / (b.at - a.at);
}

describe("the spot slides along the lamp's path, as the mockup's one spot", () => {
  for (const [name, snap, from] of [
    ["after a glide, a kick and a dim", gliding(), 20],
    ["at rest", snapOf(restingLamp([437, 180, 1]), false), 0],
  ] as const) {
    test(name, () => {
      const t = track(snap);
      const { w, h } = BACK.box;
      for (const at of [0, 0.37, 1.5, 4.3, 11, 40, 123.4, 270].map((s) => s + from)) {
        const sec = Math.round(at / FRAME) * FRAME;
        const want = glossSpot(BACK.placed.x, BACK.placed.y, w, h, rigAfter(snap, Math.round(sec / FRAME)));
        const got = slid(t, sec);
        assert.ok(Math.abs(got.x - want.spot.x) < 0.5, `x at ${sec}s: ${got.x} against ${want.spot.x}`);
        assert.ok(Math.abs(got.y - want.spot.y) < 0.5, `y at ${sec}s`);
        assert.ok(Math.abs(got.alpha - want.spotAlpha) < 0.004, `alpha at ${sec}s`);
      }
    });
  }

  test("a crossfade of the two ends, 40 points apart, would dim the core at mid-sway to under 60%: the reason it slides", () => {
    const apart = 2 * swayAmplitude(0);
    const core = 1 - (1 - 0.5 * profile(apart / 2)) ** 2;
    assert.ok(core < 0.6, `a crossfade would leave ${core} of the spot's peak`);
    assert.equal(profile(0), 1);
  });

  test("a glide's stops follow the exponential at 2.2 a second", () => {
    assert.equal(GLIDE, 2.2);
    const snap = gliding();
    const t = track(snap);
    for (const n of t.stops.filter((n) => n * FRAME < 6)) {
      const sec = n * FRAME;
      assert.ok(Math.abs(t.path.x[n]! - (snap.tx + (snap.x - snap.tx) * Math.exp(-GLIDE * sec))) < 1e-6, `x at ${sec}s`);
      assert.ok(Math.abs(t.path.y[n]! - (snap.ty + (snap.y - snap.ty) * Math.exp(-GLIDE * sec))) < 1e-6, `y at ${sec}s`);
    }
  });
});

describe("the spot against the mockup's own gloss()", () => {
  const LOOP = "  for(const[c,cx,cy]of list){";
  const perCard = fixtureLine(LOOP).slice(LOOP.length);
  const streak = fixtureLine("    const ang=").trim();
  const paint = fixtureLine("    c._gl.style.background=");
  const [, sx, sy] = /circle \d+px at \$\{\((.+?)\)\.toFixed\(1\)\}px \$\{\((.+?)\)\.toFixed\(1\)\}px/.exec(paint)!;

  test("is within a point along the sway at rest", () => {
    const snap = snapOf(restingLamp([437, 180, 1]), false);
    const t = track(snap);
    for (const at of [0, 0.25, 0.9, 2, 3.5, 8]) {
      const sec = Math.round(at / FRAME) * FRAME;
      const lamp = rigAfter(snap, Math.round(sec / FRAME));
      const got = runFixture([fixtureLine("const clamp="), perCard, streak, `var spotX=${sx},spotY=${sy};`], {
        c: { _w: BACK.box.w, _h: BACK.box.h },
        cx: BACK.placed.x,
        cy: BACK.placed.y,
        lx: lamp.lx,
        ly: lamp.ly,
        lamp: { L: lamp.level },
      }) as Record<string, number>;
      const { x, y } = slid(t, sec);
      assert.ok(Math.abs(x - got.spotX!) <= 1, `x at ${sec}s: ${x} against the mockup's ${got.spotX}`);
      assert.ok(Math.abs(y - got.spotY!) <= 1, `y at ${sec}s: ${y} against the mockup's ${got.spotY}`);
    }
  });
});

describe("the gloss follows the lamp live while it moves", () => {
  test("a glide, a kick and a dim are live, and the settled lamp is not", () => {
    const snap = gliding();
    assert.equal(glossLive(rigFrom(snap)), true, "mid-glide");
    assert.equal(glossLive(rigAfter(snap, 60)), true, "a second into the glide");
    assert.equal(glossLive(rigAfter(snap, 60 * 25)), false, "settled");
    const resting = restingLamp([437, 180, 1]);
    assert.equal(glossLive(resting), false, "at rest");
    lampControls.kick(resting, false);
    assert.equal(glossLive(resting), true, "kicked");
    const dim = restingLamp([437, 180, 1]);
    lampControls.hold(dim, "lost", 0.4, 3);
    stepLamp(dim, FRAME, false);
    assert.equal(glossLive(dim), true, "dimming");
  });
});

describe("the streak pair", () => {
  test("stands where the lamp comes to rest, which the live gloss hands over to once the glide is over", () => {
    const snap = gliding();
    const ends = streakPose(track(snap), BACK.placed, BACK.box);
    const { placed, box } = BACK;
    const settled = rigAfter(snap, 60 * 25);
    assert.equal(glossLive(settled), false);
    for (const [end, side] of [[ends[0], -1], [ends[1], 1]] as const) {
      const g = cardGloss(placed.x, placed.y, box.w, box.h, { lx: settled.x + side * swayAmplitude(0), ly: settled.ly, level: settled.level, r: settled.r });
      assert.ok(Math.abs(end.x - g.band.x) < 0.5 && Math.abs(end.y - g.band.y) < 0.5 && Math.abs(end.opacity - g.a) < 0.004, `end ${side}`);
    }
  });

  test("crossfaded, draws a band within a quarter of the exact one's half-width, and at 85% of its brightness, along a sway", () => {
    const snap = snapOf(restingLamp([437, 180, 1]), false);
    const t = track(snap);
    const shared = sharedTrack(t);
    const ends = streakPose(t, BACK.placed, BACK.box);
    let place = 0;
    let bright = 1;
    for (let n = 0; n < 1800; n += 22) {
      const sec = n * FRAME;
      const lamp = rigAfter(snap, n);
      const exact = cardGloss(BACK.placed.x, BACK.placed.y, BACK.box.w, BACK.box.h, lamp);
      const fadeB = valueAt(shared.fadeB!.keyframes as Frames, shared.fadeB!.duration, sec, (f) => f.opacity as number);
      assert.ok(Math.abs(fadeB - crossAt(0, lamp.lx, lamp.x)) < 0.02, "the fade is the sway's share");
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

  test("a kick's sway is the rig's, far past the resting twenty points", () => {
    assert.ok(swayAmplitude(1) > 90 && swayAmplitude(0) === 20);
  });
});

describe("when the track is rebaked", () => {
  const rest = () => {
    const s = restingLamp([437, 180, 1]);
    return { s, baked: snapOf(s, false) };
  };
  const later = (s: Lamp, seconds: number) => {
    for (let n = 0; n < seconds * 60; n++) stepLamp(s, FRAME, false);
  };

  test("never while the lamp sways on its course", () => {
    const { s, baked } = rest();
    for (let n = 0; n < 600; n++) {
      stepLamp(s, FRAME, false);
      assert.equal(nextGlossBake(baked, s, false), null, `frame ${n}`);
    }
  });

  test("on a new target, a kick, a level, a freeze, reduced motion, and before the horizon ends", () => {
    const moves: [string, (s: Lamp) => void][] = [
      ["target", (s) => lampControls.setTarget(s, [300, 200, 1], false)],
      ["kick", (s) => lampControls.kick(s, false)],
      ["level", (s) => lampControls.hold(s, "lost", 0.5, 3)],
      ["jump of the level", (s) => (s.lvl = 0.3)],
      ["freeze", (s) => lampControls.freeze(s, 1)],
    ];
    for (const [name, move] of moves) {
      const { s, baked } = rest();
      later(s, 1);
      move(s);
      assert.notEqual(nextGlossBake(baked, s, false), null, name);
    }
    const { s, baked } = rest();
    assert.notEqual(nextGlossBake(baked, s, true), null, "reduced motion");
    s.t += GLOSS_HORIZON_S - 5;
    assert.notEqual(nextGlossBake(baked, s, false), null, "horizon");
  });
});

describe("a track that has nothing to play", () => {
  test("a frozen lamp at rest plays nothing, and reduced motion neither", () => {
    const s = restingLamp([437, 180, 1]);
    lampControls.freeze(s, 1);
    assert.equal(track(snapOf(s, false)).moves, false);
    const r = restingLamp([437, 180, 1]);
    assert.equal(track(snapOf(r, true)).moves, false);
  });

  test("a resting lamp plays its sway for the whole horizon", () => {
    const t = track(snapOf(restingLamp([437, 180, 1]), false));
    assert.equal(t.moves, true);
    assert.equal(t.stops[t.stops.length - 1], GLOSS_HORIZON_S * 60);
  });
});
