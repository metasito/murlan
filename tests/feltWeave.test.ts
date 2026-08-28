// tests/feltWeave.test.ts — the weave reads the same on every felt the player
// can choose, and at every point along each one's falloff.
//
// The felt is a cosmetic: `FeltGradients` has four, from a bright green to a
// desaturated grey, and each is five stops from a lit centre to an unlit rim.
// A thread that *adds* light lands differently on all twenty of those surfaces
// — brightest, in relative terms, on the darkest — which is why the crosshatch
// used to be loudest in the corner with no light in it.
//
// A thread that is a shadow cannot: it takes a fixed fraction of whatever it is
// laid over, so its relief is one number for every felt and every stop. That is
// the whole reason the threads never have to move with the lamp, and it is
// arithmetic rather than a rendering, so it is checked here rather than in a
// browser.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { FeltGradients, Lantern } from "../lib/tokens.ts";

/** Rec. 709 luminance of an opaque `#rrggbb`. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function parse(rgba: string): { lum: number; alpha: number } {
  const m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(rgba);
  assert.ok(m, `not an rgba colour: ${rgba}`);
  return {
    lum: 0.2126 * Number(m[1]) + 0.7152 * Number(m[2]) + 0.0722 * Number(m[3]),
    alpha: m[4] === undefined ? 1 : Number(m[4]),
  };
}

const over = (base: number, thread: { lum: number; alpha: number }) =>
  base * (1 - thread.alpha) + thread.lum * thread.alpha;

/**
 * The hatch as a fraction of the cloth it sits on, for one felt stop: the two
 * threads cross, so the darkest point carries both and the brightest is bare
 * cloth. Mean is approximated by the three regions in the proportions a 1px
 * thread every 3px produces, which is enough to compare surfaces against each
 * other — the same measure `tests/e2e/feltNap.spec.ts` takes off real pixels.
 */
function regions(stop: string, threads: string[]): number[] {
  const base = luminance(stop);
  const parsed = threads.map(parse);
  // Bare cloth, either thread alone, and the crossing where both apply.
  return [base, ...parsed.map((t) => over(base, t)), parsed.reduce(over, base)];
}

/**
 * Brightest region minus darkest, in levels. Taking bare cloth as the brightest
 * is what a shadow guarantees and an added highlight does not, so assuming it
 * would hide the very case this measure exists to catch.
 */
function amplitude(stop: string, threads: string[]): number {
  const r = regions(stop, threads);
  return Math.max(...r) - Math.min(...r);
}

function relief(stop: string, threads: string[]): number {
  const [base, a, b, both] = regions(stop, threads);
  const mean = (base * 4 + a * 2 + b * 2 + both) / 9;
  return amplitude(stop, threads) / Math.max(mean, 1);
}

const SHADOW = [Lantern.weaveShade, Lantern.weaveShadeCross];
/** What shipped before: one thread adding light, one taking it away. */
const ADDITIVE = ["rgba(255,255,255,0.02)", "rgba(0,0,0,0.055)"];

const everyStop = () =>
  Object.entries(FeltGradients).flatMap(([felt, stops]) =>
    stops.map((stop, i) => ({ felt, stop, index: i }))
  );

describe("the weave is the same cloth whichever felt is chosen", () => {
  test("its relief does not move across the four felts, or along any falloff", () => {
    const measured = everyStop().map((s) => ({ ...s, relief: relief(s.stop, SHADOW) }));
    assert.ok(measured.length >= 20, "the felt cosmetics are no longer five stops each");

    const lo = Math.min(...measured.map((m) => m.relief));
    const hi = Math.max(...measured.map((m) => m.relief));
    // Shadow is multiplicative, so this spread is rounding and nothing else.
    assert.ok(
      hi - lo < 0.005,
      `the crosshatch is not the same depth on every felt: ${lo.toFixed(4)}…${hi.toFixed(4)}\n` +
        measured
          .map((m) => `  ${m.felt}[${m.index}] ${m.relief.toFixed(4)}`)
          .join("\n")
    );
  });

  test("both threads are shadow, whatever the tokens are set to", () => {
    for (const thread of SHADOW) {
      const { lum, alpha } = parse(thread);
      assert.equal(lum, 0, `${thread} adds light, so its lift does not scale with the lamp`);
      assert.ok(alpha > 0 && alpha < 1, `${thread} is not a translucent thread`);
    }
  });

  // Constant relief follows from the threads being black, so the two tests
  // above are together one claim about their *colour* and say nothing about
  // how deep they are. This is the only part that holds the chosen alphas, and
  // it is deliberately the lit end alone: because amplitude is a fraction of
  // the base, any ratio between two stops of the same felt reduces to that
  // felt's own contrast and would pass whatever the threads were set to.
  //
  // What the crosshatch does on cloth the lamp is not reaching is a claim about
  // rendered pixels rather than about a stop, and `tests/e2e/feltNap.spec.ts`
  // is where it is measured.
  test("the depth chosen is legible on lit cloth, on every felt", () => {
    for (const [felt, stops] of Object.entries(FeltGradients)) {
      const lit = amplitude(stops[0], SHADOW);
      assert.ok(lit > 6, `${felt}'s weave is invisible under the lamp: ${lit.toFixed(1)} levels`);
      assert.ok(lit < 20, `${felt}'s weave is coarse under the lamp: ${lit.toFixed(1)} levels`);
    }
  });

  // The floor. The property above is worth nothing unless the arrangement it
  // rules out actually fails it, and the arrangement is the one that shipped.
  test("an additive thread fails the same measure, worst on the darkest cloth", () => {
    const measured = everyStop().map((s) => ({ ...s, relief: relief(s.stop, ADDITIVE) }));
    const lo = Math.min(...measured.map((m) => m.relief));
    const hi = Math.max(...measured.map((m) => m.relief));
    assert.ok(hi - lo > 0.02, "the additive fixture no longer models the defect");

    // …and specifically: the unlit rim of each felt carries more relief than
    // its own lit centre. Every felt, not just the default one.
    for (const [felt, stops] of Object.entries(FeltGradients)) {
      const lit = relief(stops[0], ADDITIVE);
      const rim = relief(stops[stops.length - 1], ADDITIVE);
      assert.ok(rim > lit, `${felt} did not show the inversion the fixture is for`);
    }
  });
});
