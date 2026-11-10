// tests/ui-rules/glossTrack.test.ts — an opponent's back is lit by a keyframe track the compositor plays,
// and the track is the Lantern Table's `gloss()` at every moment of it (rest-design PR E).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { GLIDE, lampControls, restingLamp, stepLamp, type Lamp } from "../../components/table/lampRig.ts";
import { cardGloss, glossSpot } from "../../components/table/cardGloss.ts";
import { backPose, bakeGlossTrack, crossAt, GLOSS_HORIZON_S, nextGlossBake, sharedTrack, snapOf, swayAmplitude, type GlossTrack, type LampSnap } from "../../components/table/glossTrack.ts";
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

const moveOf = (frame: Record<string, unknown>, axis: "translateX" | "translateY") =>
  (frame.transform as Record<string, number>[]).find((t) => axis in t)![axis]!;

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

describe("the spot's keyframes are glossSpot along the lamp's path", () => {
  for (const [name, snap] of [
    ["gliding, kicked and dimmed", gliding()],
    ["at rest", snapOf(restingLamp([437, 180, 1]), false)],
  ] as const) {
    test(name, () => {
      const t = track(snap);
      const shared = sharedTrack(t, S);
      const pose = backPose(t, BACK.placed, BACK.box);
      const { w, h } = BACK.box;
      for (const at of [0, 0.1, 0.37, 0.8, 1.5, 2.9, 4.3, 6, 11, 40, 123.4, 290]) {
        const sec = Math.round(at / FRAME) * FRAME;
        const lamp = rigAfter(snap, Math.round(sec / FRAME));
        const want = glossSpot(BACK.placed.x, BACK.placed.y, w, h, lamp);
        const dx = shared.spot ? valueAt(shared.spot.keyframes as Frames, shared.spot.duration, sec, (f) => moveOf(f, "translateX")) : 0;
        const dy = shared.spot ? valueAt(shared.spot.keyframes as Frames, shared.spot.duration, sec, (f) => moveOf(f, "translateY")) : 0;
        const alpha = shared.spot ? valueAt(shared.spot.keyframes as Frames, shared.spot.duration, sec, (f) => f.opacity as number) : pose.spotAlpha;
        assert.ok(Math.abs((pose.spot.x * S + dx) / S - want.spot.x) < 0.5, `x at ${sec}s: ${(pose.spot.x * S + dx) / S} against ${want.spot.x}`);
        assert.ok(Math.abs((pose.spot.y * S + dy) / S - want.spot.y) < 0.5, `y at ${sec}s`);
        assert.ok(Math.abs(alpha - want.spotAlpha) < 0.004, `alpha at ${sec}s`);
      }
    });
  }

  test("a glide's stops follow the exponential at 2.2 a second", () => {
    assert.equal(GLIDE, 2.2);
    const snap = gliding();
    const t = track(snap);
    for (const n of t.stops.slice(0, t.eventStops + 1)) {
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

  test("is within a point along a glide with a kick", () => {
    const snap = gliding();
    const t = track(snap);
    const shared = sharedTrack(t, S);
    const pose = backPose(t, BACK.placed, BACK.box);
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
      const x = (pose.spot.x * S + valueAt(shared.spot!.keyframes as Frames, shared.spot!.duration, sec, (f) => moveOf(f, "translateX"))) / S;
      const y = (pose.spot.y * S + valueAt(shared.spot!.keyframes as Frames, shared.spot!.duration, sec, (f) => moveOf(f, "translateY"))) / S;
      assert.ok(Math.abs(x - got.spotX!) <= 1, `x at ${sec}s: ${x} against the mockup's ${got.spotX}`);
      assert.ok(Math.abs(y - got.spotY!) <= 1, `y at ${sec}s: ${y} against the mockup's ${got.spotY}`);
    }
  });
});

describe("the streak pair", () => {
  test("crossfades to within a quarter of the exact streak, in its half-width and its opacity, along a sway", () => {
    const snap = snapOf(restingLamp([437, 180, 1]), false);
    const t = track(snap);
    const shared = sharedTrack(t, S);
    const pose = backPose(t, BACK.placed, BACK.box);
    let worst = 0;
    for (let n = 0; n < 1800; n += 22) {
      const sec = n * FRAME;
      const lamp = rigAfter(snap, n);
      const exact = cardGloss(BACK.placed.x, BACK.placed.y, BACK.box.w, BACK.box.h, lamp);
      const fadeB = valueAt(shared.fadeB!.keyframes as Frames, shared.fadeB!.duration, sec, (f) => f.opacity as number);
      assert.ok(Math.abs(fadeB - crossAt(0, lamp.lx, lamp.x)) < 0.02, "the fade is the sway's share");
      const [a, b] = pose.streak;
      const x = a.x * (1 - fadeB) + b.x * fadeB;
      const opacity = a.opacity * (1 - fadeB) + b.opacity * fadeB;
      worst = Math.max(worst, Math.abs(x - exact.band.x) / exact.band.half, Math.abs(opacity - exact.a) / exact.a);
    }
    assert.ok(worst < 0.25, `worst relative error ${worst}`);
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
