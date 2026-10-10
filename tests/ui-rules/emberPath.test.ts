import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { emberFrame, emberSweep, idleEmber, RIM, startEmber } from "../../components/table/ember.ts";
import { Handoff } from "../../lib/tokens.ts";

const EMBER_MS = Handoff.emberMs;
import { seatDirection } from "../../components/seatLayout.ts";

const nextInTurn = (seat: number, n: number) => (seat - 1 + n) % n;
const sweep = (from: number, to: number, n: number) => {
  const [a0, a1] = emberSweep(seatDirection(from, 0, n), seatDirection(to, 0, n));
  return a1 - a0;
};

describe("the ember's sweep between two seats", () => {
  for (const n of [2, 3, 4]) {
    test(`runs in turn order at ${n} players, through exactly the seats between`, () => {
      for (let from = 0; from < n; from++) {
        let along = 0;
        let prev = from;
        for (let to = nextInTurn(from, n); to !== from; prev = to, to = nextInTurn(to, n)) {
          along += sweep(prev, to, n);
          const s = sweep(from, to, n);
          assert.ok(s > 0 && s < 360, `${from}→${to}: ${s}`);
          assert.equal(s, along, `${from}→${to}`);
        }
        assert.equal(along + sweep(prev, from, n), 360);
      }
    });
  }

  test("starts at the viewer's seat at the bottom of the rim", () => {
    assert.equal(emberSweep("bottom", "left")[0], 90);
    assert.deepEqual(emberSweep("right", "bottom"), [0, 90]);
  });
});

describe("one ember run", () => {
  const frames = (run: ReturnType<typeof idleEmber>, dt = 1 / 60) => {
    const out = [];
    for (let i = 0; i < 60 && run.t >= 0; i++) out.push(emberFrame(run, dt, () => 0.5));
    return out;
  };

  test("throws one head and one trail spark a frame, on the rim, for 380 ms", () => {
    const run = idleEmber();
    assert.deepEqual(emberFrame(run, 1 / 60, () => 0.5), []);
    startEmber(run, "bottom", "left");
    const out = frames(run);
    assert.equal(out.length, Math.ceil(EMBER_MS / (1000 / 60)) + 1);
    for (const [head, trail, ...rest] of out) {
      assert.deepEqual(rest, []);
      assert.deepEqual([head.life, head.size, head.glow], [0.05, 2.4, 10]);
      assert.deepEqual([trail.x, trail.y, trail.drag, trail.glow], [head.x, head.y, 0.9, 4]);
      assert.ok(Math.abs(((head.x - RIM.cx) / RIM.rx) ** 2 + ((head.y - RIM.cy) / RIM.ry) ** 2 - 1) < 1e-9);
    }
    assert.ok(Math.abs(out[0][0].y - (RIM.cy + RIM.ry)) < 1e-9);
    assert.ok(Math.abs(out.at(-1)![0].x - (RIM.cx - RIM.rx)) < 1e-9);
  });

  test("a new hand-off restarts the one run rather than queueing a second", () => {
    const run = idleEmber();
    startEmber(run, "bottom", "left");
    for (let i = 0; i < 6; i++) emberFrame(run, 1 / 60, () => 0.5);
    startEmber(run, "left", "top");
    const out = frames(run);
    assert.ok(Math.abs(out[0][0].x - (RIM.cx - RIM.rx)) < 1e-9);
    assert.equal(out.length, Math.ceil(EMBER_MS / (1000 / 60)) + 1);
  });
});
