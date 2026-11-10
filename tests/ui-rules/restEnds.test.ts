// tests/ui-rules/restEnds.test.ts — the felt at rest: when the table counts as rested, what the canvas draws
// for it, and that the baked opacity track hands over to the live rig within half a point.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { lampControls, restingLamp, stepLamp, SWAY, type Lamp, type Pool } from "../../components/table/lampRig.ts";
import { endTrack, isRested, leanOf, NOT_SHOWN, nextShown, shownLamp, START_LAG_MS } from "../../components/table/restEnds.ts";
import { TRACK_SECONDS, TRACK_STEP, trackAt } from "../../lib/swayTable.ts";

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

describe("the baked track hands over to the live rig", () => {
  const LAGS_MS = [0, 4, 8, 12, 16];

  /** Offset of the live light from its target against the track's, over its window, when the animation really started `lagMs` after the state was read. */
  function worstHandoff(rig: Lamp, lagMs: number): { first: number; worst: number } {
    const { ph, t, tx } = { ph: rig.ph, t: rig.t, tx: rig.tx };
    const track = endTrack(ph, t, 0);
    const sway = Object.values(track.keyframes).map((k) => (k as { opacity: number }).opacity * 2 - 1);
    assert.equal(sway.length, Math.round(TRACK_SECONDS / TRACK_STEP) + 1);
    const lead = -track.delay / 1000;
    const started = lagMs / 1000;
    let first = 0;
    let worst = 0;
    run(rig, TRACK_SECONDS - 1, (s, since) => {
      const wall = since + DT;
      if (wall < started) return;
      const baked = tx + SWAY * trackAt(sway, wall - started + lead);
      const jump = Math.abs(s.lx - baked);
      if (first === 0) first = jump;
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
    ["after a 2.7 s freeze", (s: Lamp) => {
      lampControls.freeze(s, 1);
      run(s, 2.7);
      lampControls.freeze(s, 0);
    }],
    ["after a freeze 297 s into the rig's clock", (s: Lamp) => {
      run(s, 297);
      lampControls.freeze(s, 1);
      run(s, 2.7);
      lampControls.freeze(s, 0);
    }],
  ] as const) {
    test(`jumps under ${HANDOFF_PT} pt at the handoff and through its window ${what}, for an animation that starts 0 to 16 ms late`, () => {
      for (const lag of LAGS_MS) {
        const rig = restedLamp();
        settle(rig);
        assert.equal(isRested(rig), true);
        const { first, worst } = worstHandoff(rig, lag);
        assert.ok(first < HANDOFF_PT, `${lag} ms: the first frame is ${first} pt off`);
        assert.ok(worst < HANDOFF_PT, `${lag} ms: ${worst} pt off over the window`);
      }
    });
  }

  test("is leaned on the start lag it assumes: a start 40 ms late is over the line", () => {
    const rig = restedLamp();
    const { worst } = worstHandoff(rig, 40);
    assert.ok(worst > HANDOFF_PT, `${worst} pt at a lag five times START_LAG (${START_LAG_MS} ms)`);
  });
});
