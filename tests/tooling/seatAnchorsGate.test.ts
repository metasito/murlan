import { test } from "node:test";
import assert from "node:assert/strict";
import { GATES } from "../../scripts/diagnostics-verdict.mjs";

const STATES = ["counts-13-13-13", "counts-2-13-2", "counts-2-1-2", "counts-top-out"];
const DEAL = { Luan: [780, 180], Drita: [420, 40], Besnik: [60, 180] } as Record<string, [number, number]>;
const HOLD = 1000;
const PROBE = 250;

type Shift = (name: string, state: number) => [number, number];
const still: Shift = () => [0, 0];

const rows = (shift: Shift = still, states = STATES, rings = Object.keys(DEAL)) => [
  ...rings.map((name) => ({ k: "ring", t: 0, name, x: 0, y: 0 })),
  ...states.flatMap((id, i) => {
    const at = 2000 + i * 3000;
    return [
      { k: "seatState", t: at, id, of: STATES.length },
      ...Array.from({ length: HOLD / PROBE }, (_, s) =>
        rings.map((name) => {
          const [dx, dy] = shift(name, i);
          return { k: "ring", t: at + (s + 1) * PROBE, name, x: DEAL[name][0] + dx, y: DEAL[name][1] + dy };
        })
      ).flat(),
    ];
  }),
];

test("rings that never move pass, and the metrics carry what was judged", () => {
  const r = GATES.seatAnchors(rows());
  assert.equal(r.pass, true);
  assert.deepEqual(r.metrics, { drift: 0, rings: 3, states: 4, of: 4, unmeasured: 0 });
});

test("a ring 0.4 pt off its deal position passes", () => {
  assert.equal(GATES.seatAnchors(rows((name, i) => (name === "Besnik" && i > 0 ? [0, 0.4] : [0, 0]))).pass, true);
});

test("a ring 0.6 pt off its deal position fails, on either axis", () => {
  const y = GATES.seatAnchors(rows((name, i) => (name === "Besnik" && i === 1 ? [0, 0.6] : [0, 0])));
  assert.equal(y.pass, false);
  assert.ok(Math.abs(y.metrics.drift - 0.6) < 1e-9);
  assert.equal(GATES.seatAnchors(rows((name, i) => (name === "Drita" && i === 3 ? [-0.6, 0] : [0, 0]))).pass, false);
});

test("a ring missing at the deal fails", () => {
  const r = GATES.seatAnchors(rows(still, STATES, ["Luan", "Besnik"]));
  assert.equal(r.pass, false);
  assert.equal(r.metrics.rings, 2);
});

test("three states of four fail", () => {
  const r = GATES.seatAnchors(rows(still, STATES.slice(0, 3)));
  assert.equal(r.pass, false);
  assert.equal(r.metrics.states, 3);
});

test("a state recorded with no ring sampled after it fails: a stopped probe is not a still ring", () => {
  const r = GATES.seatAnchors(rows().filter((row) => !(row.k === "ring" && row.t > 8000)));
  assert.equal(r.pass, false);
  assert.equal(r.metrics.unmeasured, 2);
});
