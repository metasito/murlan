// tests/motionScale.test.ts — what makes `Motion.duration` a scale rather
// than a list of numbers some component wanted.
//
// No test can catch a feel regression: `react-test-renderer` never runs time,
// and whether 260ms reads as weight is settled by a human watching it (#126).
// What a test *can* hold is the shape the decision has to keep — that every
// step earns its place, that they stay in order, and above all that none ships
// without the reduced form stated, because the one thing a sweep will invent
// per call site is the answer nobody wrote down.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Motion } from "../lib/tokens.ts";

const steps = Object.entries(Motion.duration) as [string, number][];

test("every step states what it becomes under reduced motion", () => {
  const reduced = Motion.reduced as Record<string, number | null>;
  const missing = steps.map(([name]) => name).filter((name) => !(name in reduced));
  assert.deepEqual(
    missing,
    [],
    "a step with no reduced form is one the next sweep will invent an answer for, " +
      `per call site: ${missing.join(", ")}`
  );

  const spare = Object.keys(reduced).filter((name) => !(name in Motion.duration));
  assert.deepEqual(
    spare,
    [],
    `a reduced form for a step that no longer exists: ${spare.join(", ")}`
  );
});

test("a reduced step is never slower than the step itself", () => {
  for (const [name, ms] of steps) {
    const to = (Motion.reduced as Record<string, number | null>)[name];
    if (to === null) continue;
    assert.ok(
      to <= ms,
      `reduced motion makes ${name} slower (${ms}ms -> ${to}ms), which is the opposite of asking for less`
    );
  }
});

// A scale is ordered, and each step is a step away from its neighbour. Two
// steps a hair apart are one step and a number somebody wanted — the trap #52
// named — and out-of-order steps mean the names no longer say which is longer.
test("the steps ascend, and none is a rounding of its neighbour", () => {
  const values = steps.map(([, ms]) => ms);
  const sorted = [...values].sort((a, b) => a - b);
  assert.deepEqual(
    values,
    sorted,
    `the steps are declared out of order (${steps.map(([n, ms]) => `${n} ${ms}`).join(", ")}), ` +
      "so the names no longer say which is longer"
  );

  for (let i = 1; i < steps.length; i++) {
    const [prev, prevMs] = steps[i - 1];
    const [name, ms] = steps[i];
    assert.ok(
      ms >= prevMs * 1.25,
      `${name} (${ms}ms) is within a quarter of ${prev} (${prevMs}ms) — that is one step ` +
        "and a number somebody wanted, not two roles"
    );
  }
});

// The decision itself, pinned so a later edit is a deliberate one. The owner
// chose Balanced watching a 260ms flight with a 40ms load; a silent drift back
// toward Weighted's 380 or Crisp's 160 should have to argue with this line.
test("the card's flight is the weight that was chosen", () => {
  assert.equal(
    Motion.duration.travel,
    260,
    "travel is the card in flight, and 260ms is the Balanced model the owner chose (#126)"
  );
  assert.equal(
    Motion.anticipate,
    40,
    "the load before the launch is what makes travel read as weight rather than as a duration"
  );
});

test("travel and shift lose their travel entirely under reduced motion", () => {
  assert.equal(Motion.reduced.shift, 0, "a shift that still travels has not been reduced");
  assert.equal(Motion.reduced.travel, 0, "a card that still flies has not been reduced");
});
