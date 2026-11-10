// tests/ui-rules/restEnds.test.ts — the felt at rest: when the table counts as rested, what the canvas draws
// for it, and that the baked opacity track hands over to the live rig within half a point.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { lampControls, restingLamp, stepLamp, SWAY, type Lamp, type Pool } from "../../components/table/lampRig.ts";
import { DRIFT_CHECK_MS, DRIFT_PT, driftPt, endTrack, isRested, leanOf, NOT_SHOWN, nextShown, placeOf, shownLamp } from "../../components/table/restEnds.ts";
import { TRACK_SECONDS, trackAt } from "../../lib/swayTable.ts";

const DT = 1 / 60;
const POOL: Pool = [437, 300, 1];
/** The most the baked light may be off the live rig at the handoff and after (RESULT.md Q3). */
const HANDOFF_PT = 0.5;

function run(s: Lamp, seconds: number, frame: (s: Lamp, t: number) => void = () => {}) {
  for (let t = 0; t < seconds; t += DT) {
    stepLamp(s, DT, false);
    frame(s, t);
  }
}

function restedLamp(): Lamp {
  const s = restingLamp(POOL);
  run(s, 30);
  return s;
}

describe("isRested", () => {
  test("holds for a lamp that has come to its target and only sways", () => {
    assert.equal(isRested(restedLamp()), true);
  });

  test("fails while it glides, flares, is kicked, changes level, or is frozen", () => {
    const moved: [string, (s: Lamp) => void][] = [
      ["glide", (s) => lampControls.setTarget(s, [POOL[0] + 200, POOL[1], POOL[2]], false)],
      ["flare", (s) => lampControls.flare(s, false)],
      ["kick", (s) => lampControls.kick(s, false)],
      ["level", (s) => lampControls.hold(s, "lost", 0.4, 2)],
      ["freeze", (s) => lampControls.freeze(s, 1)],
    ];
    for (const [what, apply] of moved) {
      const s = restedLamp();
      apply(s);
      run(s, 2 * DT);
      assert.equal(isRested(s), false, what);
    }
  });

  test("returns once the flare, the kick and the glide are spent", () => {
    const s = restedLamp();
    lampControls.setTarget(s, [POOL[0] + 200, POOL[1], POOL[2]], false);
    lampControls.flare(s, false);
    lampControls.kick(s, false);
    run(s, 2);
    assert.equal(isRested(s), false);
    run(s, 12);
    assert.equal(isRested(s), true);
  });
});

describe("shownLamp", () => {
  test("is the lamp as it is for side 0", () => {
    const s = restedLamp();
    assert.deepEqual(shownLamp(s, 0), { lx: s.lx, ly: s.ly, f: s.f, r: s.r, level: s.level, lean: leanOf(s) });
  });

  test("is end A and end B of a rested lamp, a sway either side of its target", () => {
    const s = restedLamp();
    const a = shownLamp(s, -1);
    const b = shownLamp(s, 1);
    assert.equal(a.lx, POOL[0] - SWAY);
    assert.equal(b.lx, POOL[0] + SWAY);
    assert.equal(a.ly, b.ly);
    assert.deepEqual([a.lean, b.lean, a.f, b.f], [0, 1, 0, 0]);
  });

  test("is the lamp as it is when it has moved, whatever side it was asked for", () => {
    const s = restedLamp();
    lampControls.flare(s, false);
    run(s, DT);
    assert.deepEqual(shownLamp(s, -1), shownLamp(s, 0));
  });
});

describe("nextShown", () => {
  test("hands back what is drawn through ten seconds of sway at an end, and a new light each time live", () => {
    const s = restedLamp();
    const end = nextShown(NOT_SHOWN, s, -1);
    let redrawn = 0;
    let liveRedrawn = 0;
    let live = nextShown(NOT_SHOWN, s, 0);
    run(s, 10, () => {
      if (nextShown(end, s, -1) !== end) redrawn++;
      const next = nextShown(live, s, 0);
      if (next !== live) liveRedrawn++;
      live = next;
    });
    assert.equal(redrawn, 0);
    assert.ok(liveRedrawn > 100, `the live light changed only ${liveRedrawn} times`);
  });
});

describe("a rig that falls behind the wall clock", () => {
  test("is no drift while it keeps up, and is caught within seconds once it runs 1.4% slow, and gone once the animation is moved to the rig", () => {
    const rig = restedLamp();
    const track = endTrack(rig.ph, rig.t);
    let caught = -1;
    for (let ms = 1000; ms <= TRACK_SECONDS * 1000 && caught < 0; ms += 250) {
      for (let i = 0; i < 15; i++) stepLamp(rig, DT * 0.986, false);
      if (driftPt(track.sway, ms / 1000, placeOf(track, rig.t)) > DRIFT_PT) caught = ms;
    }
    assert.ok(caught > 0 && caught <= 8000, `caught at ${caught} ms`);
    assert.ok(driftPt(track.sway, placeOf(track, rig.t), placeOf(track, rig.t)) < 1e-9);
    const steady = restedLamp();
    const fresh = endTrack(steady.ph, steady.t);
    for (let i = 0; i < 600; i++) stepLamp(steady, DT, false);
    assert.ok(driftPt(fresh.sway, 10, placeOf(fresh, steady.t)) < DRIFT_PT, "a rig that keeps up is never steered");
  });

  test("is never half a point off, checked every DRIFT_CHECK_MS and steered over DRIFT_PT, for a rig 5% slow", () => {
    const rig = restedLamp();
    const track = endTrack(rig.ph, rig.t);
    const every = Math.round(DRIFT_CHECK_MS / 1000 / DT);
    let moved = 0;
    let worst = 0;
    for (let frame = 1; frame <= 60 * 25; frame++) {
      stepLamp(rig, DT * 0.95, false);
      const playing = frame * DT + moved;
      const place = placeOf(track, rig.t);
      worst = Math.max(worst, driftPt(track.sway, playing, place));
      if (frame % every === 0 && driftPt(track.sway, playing, place) > DRIFT_PT) moved += place - playing;
    }
    assert.ok(worst < 0.5, `${worst} pt off between checks`);
  });
});

describe("the baked track and the rig, once the animation is moved to where the rig is", () => {
  /** The light's offset from its target, live against the track's, from the moment the animation is steered `after` frames and `sub` of a frame in. */
  function worstHandoff(rig: Lamp, after: number, sub: number): { first: number; worst: number } {
    const track = endTrack(rig.ph, rig.t);
    const tx = rig.tx;
    let first = -1;
    let worst = 0;
    let place = 0;
    run(rig, after * DT);
    place = placeOf(track, rig.t);
    let wall = 0;
    run(rig, TRACK_SECONDS - 3, (s) => {
      wall += DT;
      const baked = tx + SWAY * trackAt(track.sway, place + wall - sub * DT);
      const jump = Math.abs(s.lx - baked);
      if (first < 0) first = jump;
      worst = Math.max(worst, jump);
    });
    return { first, worst };
  }

  for (const [what, settle] of [
    [
      "after a glide",
      (s: Lamp) => {
        lampControls.setTarget(s, [POOL[0] - 150, POOL[1], POOL[2]], false);
        run(s, 20);
      },
    ],
    [
      "after a 2.7 s freeze",
      (s: Lamp) => {
        lampControls.freeze(s, 1);
        run(s, 2.7);
        lampControls.freeze(s, 0);
      },
    ],
    [
      "after a freeze 297 s into the rig's clock",
      (s: Lamp) => {
        run(s, 297);
        lampControls.freeze(s, 1);
        run(s, 2.7);
        lampControls.freeze(s, 0);
      },
    ],
  ] as const) {
    test(`jumps under ${HANDOFF_PT} pt at the handoff and through its window ${what}, steered 2 or 3 frames in at any point of the frame`, () => {
      for (const after of [2, 3]) {
        for (const sub of [0, 0.5, 1]) {
          const rig = restedLamp();
          settle(rig);
          assert.equal(isRested(rig), true);
          const { first, worst } = worstHandoff(rig, after, sub);
          assert.ok(first < HANDOFF_PT, `${after} frames, ${sub}: the first frame is ${first} pt off`);
          assert.ok(worst < HANDOFF_PT, `${after} frames, ${sub}: ${worst} pt off over the window`);
        }
      }
    });
  }

  test("is over the line for an animation left where it started when the bake was 60 ms ago", () => {
    const rig = restedLamp();
    const { worst } = worstHandoff(rig, 3, 3.6);
    assert.ok(worst > HANDOFF_PT, `${worst} pt`);
  });
});
