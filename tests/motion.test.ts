// tests/motion.test.ts — the springs behave the way their names claim.
//
// Reanimated solves a damped harmonic oscillator, so how a spring feels is
// fixed by its damping ratio: zeta = damping / (2·sqrt(stiffness·mass)), with
// mass 1 unless it is set. Below 1 the value overshoots its target by
// exp(-pi·zeta/sqrt(1-zeta²)) and rings; at 1 it arrives and stops.
//
// This exists because two of these read as deliberate numbers while doing the
// opposite of what the comment beside them promised: `pickup`, documented as
// arriving "with no visible wobble", sat at zeta 0.43 — a 22% overshoot that
// rings several times under the finger — and `land`, wanting "one small
// bounce", had the same ratio and gave three.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Motion } from "../lib/tokens.ts";

const dampingRatio = (s: { damping: number; stiffness: number; mass?: number }) =>
  s.damping / (2 * Math.sqrt(s.stiffness * (s.mass ?? 1)));

/** Fraction by which a spring passes its target on the first swing. */
const overshoot = (zeta: number) =>
  zeta >= 1 ? 0 : Math.exp((-Math.PI * zeta) / Math.sqrt(1 - zeta * zeta));

test("pickup arrives without wobble", () => {
  const zeta = dampingRatio(Motion.spring.pickup);
  assert.ok(
    zeta >= 0.95,
    `pickup is what a card rides while it follows a finger. At zeta ${zeta.toFixed(2)} it ` +
      `overshoots by ${(overshoot(zeta) * 100).toFixed(0)}% and rings. Critical damping is ` +
      `damping = 2·sqrt(stiffness).`
  );
});

test("land bounces once, and only once", () => {
  const zeta = dampingRatio(Motion.spring.land);
  const first = overshoot(zeta);
  assert.ok(first > 0.02, `land is meant to bounce; at zeta ${zeta.toFixed(2)} it does not`);
  assert.ok(
    first < 0.12,
    `land overshoots ${(first * 100).toFixed(0)}%, which reads as a wobble rather than a landing`
  );
  // The nth overshoot is the first raised to the nth power, so bounding the
  // first below 12% already puts the second under 1.5% — nothing anyone sees.
  assert.ok(first * first < 0.015);
});

// The rest are free to be springy — none of them claims otherwise — but a
// spring that cannot settle is a bug in any role.
test("every spring settles", () => {
  for (const [name, spring] of Object.entries(Motion.spring)) {
    const zeta = dampingRatio(spring);
    assert.ok(zeta > 0.2, `${name} at zeta ${zeta.toFixed(2)} rings far too long to settle`);
    assert.ok(zeta <= 1.2, `${name} at zeta ${zeta.toFixed(2)} is overdamped and crawls in`);
  }
});
