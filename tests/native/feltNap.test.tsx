// tests/native/feltNap.test.tsx — the cloth has pile, and the pile answers to
// where the lamp is.
//
// A weave is geometry: fixed threads, one width, everywhere. Pile is not — the
// light rakes across the fibres at a grazing angle and the cloth sheens in a
// band *around* the lamp, and where the lamp does not reach there is nothing
// for the crosshatch to catch. That second half is the one a screenshot shows:
// `weaveLight` is a 2% white lift, which over a `#010B07` rim is a legible
// hatch in a corner with no light in it.
//
// Both halves are one function of distance from the lamp, so they are one
// gradient. What this pins is the three things that make it that rather than a
// third glow stacked on the pool: the sheen peaks away from the centre, it
// paints over the threads rather than under them, and it rides the lamp.
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import React from 'react';
import { act, render, screen } from '@testing-library/react-native';
import { FeltPool } from '@/components/table/felt';
import { FeltGradients, Lantern } from '@/lib/tokens';

const W = 874;
const H = 402;
/** Two of `lightPosition()`'s off-viewer fractions, on opposite sides. */
const BESNIK = { x: 0.02, y: 0.48 };
const LUAN = { x: 0.98, y: 0.48 };
/** Comfortably past felt.tsx's own LAMP_MS swing. */
const SETTLE_MS = 900;

function settle() {
  jest.advanceTimersByTime(SETTLE_MS);
  jest.runOnlyPendingTimers();
}

const SVG_VIEW = new Set(['RNSVGSvgView', 'RNSVGSvgViewAndroid']);

const alphaOf = (packed: number) => (packed >>> 24) & 0xff;

/** The alpha a token asks for, as the byte react-native-svg packs it into. */
function tokenAlpha(rgba: string): number {
  const a = /rgba?\([^)]*,\s*([\d.]+)\s*\)$/.exec(rgba);
  return Math.round((a ? Number(a[1]) : 1) * 255);
}

/** `[offset, packedColor]` for the named gradient, as the native side gets it. */
function gradientStops(name: string): [number, number][] {
  const found: [number, number][] = [];
  const walk = (node: any) => {
    if (!node || typeof node === 'string') return;
    if (node.props?.name === name && Array.isArray(node.props?.gradient)) {
      const flat: number[] = node.props.gradient;
      for (let i = 0; i < flat.length; i += 2) found.push([flat[i], flat[i + 1]]);
    }
    (node.children ?? []).forEach(walk);
  };
  walk(screen.toJSON());
  return found;
}

function findByTestId(node: unknown, testID: string): any {
  if (!node || typeof node === 'string') return null;
  const n = node as { props?: { testID?: string }; children?: unknown[] };
  if (n.props?.testID === testID) return n;
  for (const child of n.children ?? []) {
    const found = findByTestId(child, testID);
    if (found) return found;
  }
  return null;
}

/** Reads the live animated entry out of a style array. See feltTranslate.test.tsx. */
function liveStyle(testID: string) {
  const { props } = screen.getByTestId(testID);
  const flatten = (s: unknown, into: Record<string, unknown>[]) => {
    if (Array.isArray(s)) s.forEach((e) => flatten(e, into));
    else if (s) into.push(s as Record<string, unknown>);
  };
  const full: Record<string, unknown>[] = [];
  flatten(props.style, full);
  const staticEntries: Record<string, unknown>[] = [];
  flatten(props.jestInlineStyle, staticEntries);
  const staticContent = new Set(staticEntries.map((e) => JSON.stringify(e)));

  let merged: Record<string, unknown> = {};
  for (const entry of full) {
    merged = {
      ...merged,
      ...(staticContent.has(JSON.stringify(entry))
        ? entry
        : (props.jestAnimatedStyle?.value ?? {})),
    };
  }
  return merged;
}

const holdsSvg = (node: any): boolean => {
  if (!node || typeof node === 'string') return false;
  if (SVG_VIEW.has(node.type ?? '')) return true;
  return (node.children ?? []).some(holdsSvg);
};

const felt = (light: { x: number; y: number }) => (
  <FeltPool width={W} height={H} stops={FeltGradients.verde} lightX={light.x} lightY={light.y} />
);

describe('the cloth has a nap, keyed to the lamp', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('sheens in a band around the lamp rather than peaking under it', async () => {
    const r = await render(felt(BESNIK));

    const stops = gradientStops('feltNap');
    expect(stops.length).toBeGreaterThanOrEqual(4);

    const [firstOffset, firstColor] = stops[0];
    expect(firstOffset).toBe(0);
    // A third glow would put its brightest stop here, the way the core and the
    // bloom both do. Pile does the opposite: straight down the fibres there is
    // nothing to catch, and the sheen is the band further out.
    expect(alphaOf(firstColor)).toBe(0);

    const sheen = stops.find(([, c]) => alphaOf(c) === tokenAlpha(Lantern.napSheen));
    expect(sheen).toBeDefined();
    expect(sheen![0]).toBeGreaterThan(0);
    expect(sheen![0]).toBeLessThan(1);

    // …and the far end is the cloth the lamp does not reach, which is what
    // takes the crosshatch down with it.
    const [lastOffset, lastColor] = stops[stops.length - 1];
    expect(lastOffset).toBe(1);
    expect(alphaOf(lastColor)).toBe(tokenAlpha(Lantern.napShade));

    await r.unmount();
  });

  it('interpolates every segment within one hue', async () => {
    const r = await render(felt(BESNIK));

    // SVG interpolates stops non-premultiplied, so a run from a transparent
    // warm to a translucent black passes through a grey haze at half strength.
    // Each end of the profile therefore needs its own zero.
    const stops = gradientStops('feltNap');
    expect(stops.length).toBeGreaterThanOrEqual(4);
    const rgbOf = (packed: number) => packed & 0x00ffffff;
    for (let i = 1; i < stops.length; i++) {
      const [, from] = stops[i - 1];
      const [, to] = stops[i];
      const sameHue = rgbOf(from) === rgbOf(to);
      const bothClear = alphaOf(from) === 0 && alphaOf(to) === 0;
      expect(sameHue || bothClear).toBe(true);
    }

    await r.unmount();
  });

  it('paints over the threads, not under them', async () => {
    const r = await render(felt(BESNIK));

    const tree = screen.toJSON() as any;
    const kids: any[] = tree?.children ?? [];
    const nap = kids.findIndex((k) => findByTestId(k, 'felt-nap-anchor'));
    const weave = kids.findIndex(
      (k) => k?.props?.testID === undefined && SVG_VIEW.has(k?.type ?? '')
    );

    expect(weave).toBeGreaterThan(-1);
    expect(nap).toBeGreaterThan(-1);
    // Under the threads it would brighten the base the light thread contrasts
    // against, which is the wrong direction: it would make the hatch *less*
    // legible where the lamp is.
    expect(nap).toBeGreaterThan(weave);

    await r.unmount();
  });

  it('rides the lamp, and is still riding it after the turn passes', async () => {
    const r = await render(felt(BESNIK));
    await act(async () => {
      settle();
    });

    let style = liveStyle('felt-nap-anchor');
    expect(style.left).toBeCloseTo(BESNIK.x * W, 0);
    expect(style.top).toBeCloseTo(BESNIK.y * H, 0);
    expect(holdsSvg(findByTestId(screen.toJSON(), 'felt-nap-anchor'))).toBe(true);

    await act(async () => {
      r.rerender(felt(LUAN));
    });
    await act(async () => {
      settle();
    });

    style = liveStyle('felt-nap-anchor');
    expect(style.left).toBeCloseTo(LUAN.x * W, 0);
    expect(style.top).toBeCloseTo(LUAN.y * H, 0);

    // The pool and the nap read the same two values, so they cannot part
    // company mid-swing. Asserted as equality rather than as two numbers that
    // happen to match a fraction.
    const pool = liveStyle('felt-lamp-anchor');
    expect(style.left).toBe(pool.left);
    expect(style.top).toBe(pool.top);

    await r.unmount();
  });
});
