// The dealt card's arc, against the lantern mockup's `dealRun` and `flyBack` (#1262).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { backDealArc, dealBreath, dealEase, dealFlight, handDealArc } from "../../components/table/dealPose.ts";

const near = (actual: number, expected: number, what: string) => assert.ok(Math.abs(actual - expected) < 1e-6, `${what}: ${actual}, expected ${expected}`);

describe("the deal's arc", () => {
  test("eases out cubically", () => {
    for (const [k, e] of [[0, 0], [0.5, 0.875], [1, 1]]) near(dealEase(k), e, `k ${k}`);
  });

  test("the viewer's card lifts 18·sin(πe), turns from −20° to its rest, and grows from 0.8", () => {
    const rest = 7;
    const cases = [
      { e: 0, lift: 0, rot: -20, scale: 0.8 },
      { e: 0.5, lift: 18, rot: -6.5, scale: 0.9 },
      { e: 1, lift: 0, rot: 7, scale: 1 },
    ];
    for (const c of cases) {
      const p = handDealArc(c.e, rest);
      near(p.lift, c.lift, `lift at ${c.e}`);
      near(p.rot, c.rot, `rot at ${c.e}`);
      near(p.scale, c.scale, `scale at ${c.e}`);
    }
  });

  test("an opponent's back turns from 0 to its fan's angle and shrinks to 0.9, without lift", () => {
    const cases = [
      { e: 0, rot: 0, scale: 1 },
      { e: 0.5, rot: -45, scale: 0.95 },
      { e: 1, rot: -90, scale: 0.9 },
    ];
    for (const c of cases) {
      const p = backDealArc(c.e, -90);
      near(p.rot, c.rot, `rot at ${c.e}`);
      near(p.scale, c.scale, `scale at ${c.e}`);
    }
  });

  test("a back flies straight from the pile, drawn only between leaving and landing", () => {
    const leg = { key: "a", leaveMs: 100, flightMs: 260, to: { dx: 200, dy: -80, rot: 90 } };
    assert.equal(dealFlight(leg, 100).inAir, false);
    const mid = dealFlight(leg, 230);
    assert.equal(mid.inAir, true);
    near(mid.dx, 200 * 0.875, "dx halfway");
    near(mid.dy, -80 * 0.875, "dy halfway");
    near(mid.rot, 90 * 0.875, "rot halfway");
    near(mid.scale, 1 - 0.1 * 0.875, "scale halfway");
    assert.equal(dealFlight(leg, 360).inAir, false);
  });

  test("the felt breathes once, 1 + 0.006·sin(πk) over the breath, and rests at 1 either side", () => {
    for (const [since, scale] of [[-16, 1], [0, 1], [20, 1 + 0.006 * Math.sin(Math.PI / 4)], [40, 1.006], [80, 1], [200, 1]]) {
      near(dealBreath(since, 80), scale, `at ${since} ms`);
    }
  });
});
