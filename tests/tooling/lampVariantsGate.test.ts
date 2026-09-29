import { test } from "node:test";
import assert from "node:assert/strict";
import { GATES } from "../../scripts/diagnostics-verdict.mjs";
import { LAMP_FLOOR, LAMP_SIDES, LAMP_SWAY, LAMP_SYMMETRY, type LampSide } from "../../lib/diagnostics/lampLegibility.ts";

const WORST_FRAME = 7;
const at = (worst: number): Record<LampSide, number> => Object.fromEntries(LAMP_SIDES.map((s) => [s, worst])) as Record<LampSide, number>;

const rows = (worst: Partial<Record<LampSide, number>>, samples: number = LAMP_SWAY.samples) =>
  LAMP_SIDES.flatMap((side, s) =>
    worst[side] === undefined
      ? []
      : Array.from({ length: samples }, (_, i) => ({
          k: "lampLegibility",
          t: s * LAMP_SWAY.ms + (i * LAMP_SWAY.ms) / samples,
          side,
          ratio: i === WORST_FRAME ? worst[side] : worst[side]! * 1.5,
        }))
  );

test("every seat at the floor passes, and the metrics carry each seat's worst frame and the evenness", () => {
  const r = GATES.lampVariants(rows(at(LAMP_FLOOR)));
  assert.equal(r.pass, true);
  assert.deepEqual(r.metrics, { ...at(LAMP_FLOOR), evenness: 1, samples: LAMP_SWAY.samples, invalid: 0 });
});

test("a seat whose worst frame falls under the floor fails, though its other frames clear it", () => {
  const r = GATES.lampVariants(rows({ ...at(LAMP_FLOOR), top: LAMP_FLOOR * 0.99 }));
  assert.equal(r.pass, false);
  assert.equal(r.metrics.top, LAMP_FLOOR * 0.99);
});

test("uniform darkness is even and still fails: the floor catches what evenness passes", () => {
  const r = GATES.lampVariants(rows(at(LAMP_FLOOR * 0.9)));
  assert.equal(r.metrics.evenness, 1);
  assert.equal(r.pass, false);
});

test("one seat lit far past the rest fails on evenness, though every seat clears the floor", () => {
  const over = GATES.lampVariants(rows({ ...at(LAMP_FLOOR), right: (LAMP_FLOOR / LAMP_SYMMETRY) * 1.05 }));
  assert.ok(over.metrics.evenness < LAMP_SYMMETRY);
  assert.equal(over.pass, false);
  assert.equal(GATES.lampVariants(rows({ ...at(LAMP_FLOOR), right: (LAMP_FLOOR / LAMP_SYMMETRY) * 0.99 })).pass, true);
});

test("a seat never sampled fails", () => {
  const { left: _, ...three } = at(LAMP_FLOOR * 2);
  const r = GATES.lampVariants(rows(three));
  assert.equal(r.pass, false);
  assert.ok(Number.isNaN(r.metrics.left));
});

test("a seat sampled short of one sway period fails: its worst frame may be the one not taken", () => {
  const r = GATES.lampVariants(rows(at(LAMP_FLOOR * 2), LAMP_SWAY.samples - 1));
  assert.equal(r.pass, false);
  assert.equal(r.metrics.samples, LAMP_SWAY.samples - 1);
});

test("a ratio that is not a finite number fails the run", () => {
  const bad = rows(at(LAMP_FLOOR * 2));
  bad[3] = { ...bad[3], ratio: NaN };
  const r = GATES.lampVariants(bad);
  assert.equal(r.pass, false);
  assert.equal(r.metrics.invalid, 1);
});

test("a run with no ratios is not a pass", () => {
  assert.equal(GATES.lampVariants([]).pass, false);
});
