import { test } from "node:test";
import assert from "node:assert/strict";
import { GATES, medianHz, verdict } from "../../scripts/diagnostics-verdict.mjs";

type Row = { k: string; t: number; [key: string]: unknown };

const frames = (from: number, to: number, dt: number): Row[] => {
  const out: Row[] = [];
  for (let t = from + dt; t <= to; t += dt) out.push({ k: "frame", t, dt });
  return out;
};

const at = (rows: Row[], t: number, dt: number): Row[] => {
  const i = rows.findIndex((r) => r.k === "frame" && r.t >= t);
  return rows.map((r, j) => (j === i ? { ...r, dt } : r));
};

interface ThrowOpts { throws?: number; unframed?: number[]; stall?: { throw: number; at: number; k: "frame" | "jsLag" }; ticks?: number }

function throwRows({ throws = 10, unframed = [], stall, ticks = 80 }: ThrowOpts = {}): Row[] {
  return Array.from({ length: throws }, (_, i) => {
    const t = 1000 + i * 1000;
    let own: Row[] = unframed.includes(i) ? [] : frames(t, t + 700, 8);
    if (stall?.throw === i && stall.k === "frame") own = at(own, t + stall.at, 40);
    if (stall?.throw === i && stall.k === "jsLag") own.push({ k: "jsLag", t: t + stall.at, dt: 40 });
    return [{ k: "throw", t }, ...own, { k: "jsTicks", t: t + 701, n: ticks }];
  }).flat();
}

test("medianHz is the median of each second's median frame rate", () => {
  const rows = [
    { k: "frame", t: 100, dt: 10 }, { k: "frame", t: 200, dt: 10 }, { k: "frame", t: 300, dt: 20 },
    { k: "frame", t: 1100, dt: 20 }, { k: "frame", t: 1200, dt: 20 }, { k: "frame", t: 1300, dt: 10 },
    { k: "frame", t: 2100, dt: 5 }, { k: "frame", t: 2200, dt: 5 }, { k: "frame", t: 2300, dt: 5 },
    { k: "jsLag", t: 2400, dt: 1 },
  ];
  assert.equal(medianHz(rows), 100);
  assert.ok(Number.isNaN(medianHz([{ k: "jsLag", t: 1, dt: 50 }])));
});

test("throwStalls passes ten throws at 125 Hz with no stall, and reports medianHz", () => {
  const r = GATES.throwStalls(throwRows());
  assert.equal(r.pass, true);
  assert.deepEqual(r.metrics, { throws: 10, stalls: 0, framed: 1, jsTicks: 800, medianHz: 125 });
});

test("throwStalls fails one UI stall 300 ms after a throw", () => {
  const r = GATES.throwStalls(throwRows({ stall: { throw: 4, at: 300, k: "frame" } }));
  assert.equal(r.metrics.stalls, 1);
  assert.equal(r.pass, false);
});

test("throwStalls fails one JS stall 300 ms after a throw", () => {
  const r = GATES.throwStalls(throwRows({ stall: { throw: 4, at: 300, k: "jsLag" } }));
  assert.equal(r.metrics.stalls, 1);
  assert.equal(r.pass, false);
});

test("a stall ending 650 ms after its throw is outside the throw's 600 ms", () => {
  const r = GATES.throwStalls(throwRows({ stall: { throw: 4, at: 650, k: "frame" } }));
  assert.equal(r.metrics.stalls, 0);
  assert.equal(r.pass, true);
});

test("throwStalls fails nine throws", () => {
  const r = GATES.throwStalls(throwRows({ throws: 9 }));
  assert.equal(r.metrics.throws, 9);
  assert.equal(r.pass, false);
});

test("throwStalls fails when three of ten throws recorded no frames, and passes two", () => {
  const three = GATES.throwStalls(throwRows({ unframed: [1, 5, 8] }));
  assert.equal(three.metrics.framed, 0.7);
  assert.equal(three.pass, false);
  assert.equal(GATES.throwStalls(throwRows({ unframed: [1, 5] })).pass, true);
});

test("throwStalls fails a run with no JS ticks", () => {
  const r = GATES.throwStalls(throwRows({ ticks: 0 }));
  assert.equal(r.metrics.jsTicks, 0);
  assert.equal(r.pass, false);
});

type Half = { dt?: number; stall?: boolean; empty?: boolean };

function halfRows(names: [string, string], pairs: Half[][]): Row[] {
  return pairs.flatMap((pair, p) =>
    pair.flatMap(({ dt = 8, stall = false, empty = false }, i) => {
      const t = (p * 2 + i) * 3000;
      const own = empty ? [] : frames(t, t + 2000, dt);
      return [{ k: "half", t, name: names[i], pair: p }, ...(stall ? at(own, t + 1000, 40) : own), { k: "jsTicks", t: t + 2001, n: 200 }];
    })
  );
}

const fourPairs = (on: Half, off: Half): Half[][] => [[on, off], [on, off], [on, off], [on, off]];
const rest = (pairs: Half[][]) => GATES.restCost(halfRows(["frozen", "swaying"], pairs));

test("restCost passes four pairs swaying at 125 Hz with no stall, and carries both halves", () => {
  const r = rest(fourPairs({}, {}));
  assert.equal(r.pass, true);
  assert.equal(r.metrics.medianHz, 125);
  assert.deepEqual(r.metrics.frozen, [{ hz: 125, stalls: 0 }, { hz: 125, stalls: 0 }, { hz: 125, stalls: 0 }, { hz: 125, stalls: 0 }]);
  assert.deepEqual(r.metrics.swaying, [{ hz: 125, stalls: 0 }, { hz: 125, stalls: 0 }, { hz: 125, stalls: 0 }, { hz: 125, stalls: 0 }]);
});

test("restCost fails one swaying half at 100 Hz", () => {
  const pairs = fourPairs({}, {});
  pairs[2] = [{}, { dt: 10 }];
  const r = rest(pairs);
  assert.equal(r.metrics.swaying[2].hz, 100);
  assert.equal(r.pass, false);
});

test("restCost passes a swaying half at 117.6 Hz", () => {
  const pairs = fourPairs({}, {});
  pairs[2] = [{}, { dt: 8.5 }];
  assert.equal(rest(pairs).pass, true);
});

test("restCost fails one stall in one swaying half", () => {
  const pairs = fourPairs({}, {});
  pairs[1] = [{}, { stall: true }];
  const r = rest(pairs);
  assert.equal(r.metrics.swaying[1].stalls, 1);
  assert.equal(r.pass, false);
});

test("restCost does not judge the frozen halves: 50 Hz with a stall frozen still passes", () => {
  const r = rest(fourPairs({ dt: 20, stall: true }, {}));
  assert.equal(r.metrics.frozen[0].hz, 50);
  assert.equal(r.pass, true);
});

test("restCost fails three pairs", () => {
  assert.equal(rest(fourPairs({}, {}).slice(0, 3)).pass, false);
});

test("restCost fails a swaying half with no frames", () => {
  const pairs = fourPairs({}, {});
  pairs[3] = [{}, { empty: true }];
  assert.equal(rest(pairs).pass, false);
});

const felt = (pairs: Half[][]) => GATES.feltOpaque(halfRows(["on", "off"], pairs));

test("feltOpaque keeps the opaque layer when it has fewer stalls in every pair", () => {
  const r = felt(fourPairs({}, { stall: true }));
  assert.equal(r.pass, true);
  assert.equal(r.metrics.outcome, "keep");
  assert.equal(r.metrics.medianHz, 125);
});

test("feltOpaque keeps it when, stall for stall, it runs faster in every pair", () => {
  const r = felt(fourPairs({}, { dt: 10 }));
  assert.equal(r.metrics.outcome, "keep");
});

test("feltOpaque drops it on a tie: the patch must win to stay", () => {
  const r = felt(fourPairs({}, {}));
  assert.equal(r.pass, true);
  assert.equal(r.metrics.outcome, "drop");
});

test("feltOpaque drops it when it loses one pair of four", () => {
  const pairs = fourPairs({}, { stall: true });
  pairs[2] = [{ stall: true }, {}];
  const r = felt(pairs);
  assert.equal(r.metrics.wins, 3);
  assert.equal(r.metrics.outcome, "drop");
});

test("feltOpaque has no outcome, and fails, on three pairs", () => {
  const r = felt(fourPairs({}, { stall: true }).slice(0, 3));
  assert.equal(r.metrics.outcome, null);
  assert.equal(r.pass, false);
});

test("feltOpaque has no outcome, and fails, when one half recorded no frames", () => {
  const pairs = fourPairs({}, { stall: true });
  pairs[0] = [{}, { empty: true }];
  const r = felt(pairs);
  assert.equal(r.metrics.outcome, null);
  assert.equal(r.pass, false);
});

const RELEASE = { k: "build", t: 0, dev: false, scriptURL: "file:///var/containers/Bundle/Application/X/murlan.app/main.jsbundle" };
const bracket = (name: string, inner: Row[], build: object = RELEASE, batch: object[] = []) => [
  ...batch.map((b) => ({ session: "s", ...b })),
  { session: "s", ...build },
  { session: "s", k: "scenario", t: 0, name, phase: "start" },
  ...inner.map((r) => ({ session: "s", ...r })),
  { session: "s", k: "scenario", t: 60000, name, phase: "end", error: null },
];

test("each gate here is unrun on a Debug build, and fails on a dropped row", () => {
  const runs = { throwStalls: throwRows(), restCost: halfRows(["frozen", "swaying"], fourPairs({}, {})), feltOpaque: halfRows(["on", "off"], fourPairs({}, { stall: true })) };
  for (const [name, rows] of Object.entries(runs)) {
    assert.equal(verdict(bracket(name, rows), name)?.pass, true, name);
    const debug = verdict(bracket(name, rows, { ...RELEASE, dev: true }), name);
    assert.equal(debug?.pass, null, name);
    assert.equal(debug?.metrics.unrun, "dev JS", name);
    const dropped = verdict(bracket(name, rows, RELEASE, [{ k: "batch", n: 1, dropped: 1 }]), name);
    assert.equal(dropped?.pass, false, name);
    assert.equal(dropped?.metrics.dropped, 1, name);
  }
});
