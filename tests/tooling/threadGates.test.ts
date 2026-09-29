import { test } from "node:test";
import assert from "node:assert/strict";
import { GATES, burstStalls, medianHz, verdict } from "../../scripts/diagnostics-verdict.mjs";

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

interface ThrowOpts {
  throws?: number;
  unframed?: number[];
  late?: number[];
  lateBy?: number;
  stall?: { throw: number; at: number; k: "frame" | "jsLag"; dt?: number };
  ticks?: number;
}

function throwRows({ throws = 10, unframed = [], late = [], lateBy = 400, stall, ticks = 80 }: ThrowOpts = {}): Row[] {
  return Array.from({ length: throws }, (_, i) => {
    const t = 1000 + i * 1000;
    let own: Row[] = unframed.includes(i) ? [] : frames(late.includes(i) ? t + lateBy : t, t + 700, 8);
    const dt = stall?.dt ?? 40;
    if (stall?.throw === i && stall.k === "frame") own = at(own, t + stall.at, dt);
    if (stall?.throw === i && stall.k === "jsLag") own.push({ k: "jsLag", t: t + stall.at, dt });
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

test("medianHz averages the two middles of an even count, within a second and across seconds", () => {
  assert.equal(medianHz([{ k: "frame", t: 100, dt: 10 }, { k: "frame", t: 200, dt: 8 }]), 112.5);
  assert.equal(medianHz([{ k: "frame", t: 100, dt: 10 }, { k: "frame", t: 1100, dt: 8 }]), 112.5);
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

test("a UI stall starting 496 ms after its throw and ending at 696 ms fails", () => {
  const r = GATES.throwStalls(throwRows({ stall: { throw: 4, at: 696, k: "frame", dt: 200 } }));
  assert.equal(r.metrics.stalls, 1);
  assert.equal(r.pass, false);
});

test("a JS stall from before the throw to 700 ms after it fails", () => {
  const r = GATES.throwStalls(throwRows({ stall: { throw: 4, at: 700, k: "jsLag", dt: 750 } }));
  assert.equal(r.metrics.stalls, 1);
  assert.equal(r.pass, false);
});

test("a UI stall straddling the throw fails", () => {
  const r = GATES.throwStalls(throwRows({ stall: { throw: 4, at: 16, k: "frame" } }));
  assert.equal(r.metrics.stalls, 1);
  assert.equal(r.pass, false);
});

test("a stall starting 624 ms after its throw is outside the throw's 600 ms", () => {
  const r = GATES.throwStalls(throwRows({ stall: { throw: 4, at: 664, k: "frame" } }));
  assert.equal(r.metrics.stalls, 0);
  assert.equal(r.pass, true);
});

test("throwStalls fails nine throws", () => {
  const r = GATES.throwStalls(throwRows({ throws: 9 }));
  assert.equal(r.metrics.throws, 9);
  assert.equal(r.pass, false);
});

test("throwStalls fails when one throw of ten recorded no frames", () => {
  const r = GATES.throwStalls(throwRows({ unframed: [5] }));
  assert.equal(r.metrics.framed, 0.9);
  assert.equal(r.pass, false);
});

test("a window whose frames begin 400 ms late is not framed: one such fails", () => {
  const r = GATES.throwStalls(throwRows({ late: [5] }));
  assert.equal(r.metrics.framed, 0.9);
  assert.equal(r.pass, false);
});

test("a window whose frames begin 100 ms late is still framed", () => {
  const r = GATES.throwStalls(throwRows({ late: [5], lateBy: 100 }));
  assert.equal(r.metrics.framed, 1);
  assert.equal(r.pass, true);
});

test("throwStalls fails a run with no JS ticks", () => {
  const r = GATES.throwStalls(throwRows({ ticks: 0 }));
  assert.equal(r.metrics.jsTicks, 0);
  assert.equal(r.pass, false);
});

type Half = { dt?: number; stall?: boolean; empty?: boolean };

function halfRows(names: [string, string], pairs: (Half | null)[][]): Row[] {
  return pairs.flatMap((pair, p) =>
    pair.flatMap((half, i) => {
      if (!half) return [];
      const { dt = 8, stall = false, empty = false } = half;
      const t = (p * 2 + i) * 3000;
      const own = empty ? [] : frames(t, t + 2000, dt);
      return [{ k: "half", t, name: names[i], pair: p }, ...(stall ? at(own, t + 1000, 40) : own), { k: "jsTicks", t: t + 2001, n: 200 }];
    })
  );
}

const fourPairs = (on: Half | null, off: Half | null): (Half | null)[][] => [[on, off], [on, off], [on, off], [on, off]];
const rest = (pairs: (Half | null)[][]) => GATES.restCost(halfRows(["frozen", "swaying"], pairs));

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

test("restCost does not judge the frozen halves' rate: 50 Hz with a stall frozen still passes", () => {
  const r = rest(fourPairs({ dt: 20, stall: true }, {}));
  assert.equal(r.metrics.frozen[0].hz, 50);
  assert.equal(r.pass, true);
});

test("restCost fails three frozen halves beside four swaying", () => {
  const pairs = fourPairs({}, {});
  pairs[3] = [null, {}];
  assert.equal(rest(pairs).pass, false);
});

test("restCost fails three swaying halves beside four frozen", () => {
  const pairs = fourPairs({}, {});
  pairs[3] = [{}, null];
  assert.equal(rest(pairs).pass, false);
});

test("restCost fails a swaying half with no frames", () => {
  const pairs = fourPairs({}, {});
  pairs[3] = [{}, { empty: true }];
  assert.equal(rest(pairs).pass, false);
});

test("restCost fails a frozen half with no frames: the baseline is part of the record", () => {
  const pairs = fourPairs({}, {});
  pairs[3] = [{ empty: true }, {}];
  assert.equal(rest(pairs).pass, false);
});

const felt = (pairs: (Half | null)[][]) => GATES.feltOpaque(halfRows(["on", "off"], pairs));

test("feltOpaque keeps the opaque layer when its p95 frame interval is lower in every pair, stall for stall", () => {
  const r = felt(fourPairs({}, { dt: 9 }));
  assert.equal(r.pass, true);
  assert.equal(r.metrics.outcome, "keep");
  assert.equal(r.metrics.medianHz, 125);
  assert.deepEqual(r.metrics.on[0], { hz: 125, p95: 8, stalls: 0 });
  assert.deepEqual(r.metrics.off[0], { hz: 1000 / 9, p95: 9, stalls: 0 });
});

test("feltOpaque keeps it on three lower p95s of four", () => {
  const pairs = fourPairs({}, { dt: 9 });
  pairs[3] = [{}, {}];
  const r = felt(pairs);
  assert.equal(r.metrics.wins, 3);
  assert.equal(r.metrics.outcome, "keep");
});

test("feltOpaque drops it on two lower p95s of four", () => {
  const pairs = fourPairs({}, { dt: 9 });
  pairs[2] = [{}, {}];
  pairs[3] = [{}, {}];
  const r = felt(pairs);
  assert.equal(r.metrics.wins, 2);
  assert.equal(r.metrics.outcome, "drop");
});

test("feltOpaque drops it on a tie: the patch must win to stay", () => {
  const r = felt(fourPairs({}, {}));
  assert.equal(r.pass, true);
  assert.equal(r.metrics.outcome, "drop");
});

test("feltOpaque drops it when one opaque half has more stalls, though every p95 is lower", () => {
  const pairs = fourPairs({}, { dt: 9 });
  pairs[1] = [{ stall: true }, { dt: 9 }];
  const r = felt(pairs);
  assert.equal(r.metrics.wins, 4);
  assert.equal(r.metrics.outcome, "drop");
});

test("a frame with no interval changes neither a half's p95 nor the pair's comparison", () => {
  const onHalf = (t: number, withNull: boolean): Row[] => [
    { k: "half", t, name: "on", pair: (t / 1000 - 1) / 2 },
    ...Array.from({ length: 18 }, (_, i) => ({ k: "frame", t: t + 10 + i * 8, dt: 8 })),
    { k: "frame", t: t + 200, dt: 20 },
    ...(withNull ? [{ k: "frame", t: t + 300, dt: null }] : []),
  ];
  const offHalf = (t: number): Row[] => [
    { k: "half", t, name: "off", pair: (t / 1000 - 2) / 2 },
    ...Array.from({ length: 19 }, (_, i) => ({ k: "frame", t: t + 10 + i * 10, dt: 10 })),
  ];
  const run = (withNull: boolean) => GATES.feltOpaque([1000, 3000, 5000, 7000].flatMap((t) => [...onHalf(t, withNull), ...offHalf(t + 1000)]));
  const clean = run(false);
  const nulled = run(true);
  assert.equal(clean.metrics.on[0]?.p95, 20);
  assert.equal(nulled.metrics.on[0]?.p95, 20);
  assert.equal(nulled.metrics.wins, clean.metrics.wins);
  assert.equal(nulled.metrics.outcome, "drop");
});

test("a frame with no interval is not a frame to burstStalls' fast share", () => {
  const rows = [...frames(0, 248, 8), { k: "frame", t: 400, dt: null }];
  assert.deepEqual(burstStalls(rows), { stalls: 0, fastShare: 1, frames: 31, jsTicks: 0 });
});

test("feltOpaque has no outcome, and fails, on three pairs", () => {
  const r = felt(fourPairs({}, { dt: 9 }).slice(0, 3));
  assert.equal(r.metrics.outcome, null);
  assert.equal(r.pass, false);
});

test("feltOpaque has no outcome, and fails, when one half recorded no frames", () => {
  const pairs = fourPairs({}, { dt: 9 });
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
  const runs = { throwStalls: throwRows(), restCost: halfRows(["frozen", "swaying"], fourPairs({}, {})), feltOpaque: halfRows(["on", "off"], fourPairs({}, { dt: 9 })) };
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
