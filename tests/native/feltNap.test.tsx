// tests/native/feltNap.test.tsx — the cloth has pile, and the pile answers to
// where the lamp is.
//
// Two claims, and this file holds both.
//
// **The weave is shadow.** Both threads are black, at two depths, so what they
// take away is a fraction of whatever light reached them and the crosshatch
// tracks the lamp without moving. A thread that adds light cannot, which is why
// the colour is pinned here and not left to the token file.
//
// **The pile is not the weave.** It sheens in a band *around* the lamp, where
// the light rakes across the fibres and you see their sides. What is pinned
// here is what makes that a nap rather than a third glow on the pool: the peak
// is away from the centre, it paints over the threads, and it rides the lamp.
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
    expect(stops.length).toBeGreaterThanOrEqual(3);

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

    // …and it is spent by the time the light stops grazing. Carrying alpha out
    // to the edge would be a wash over the whole pool rather than a band.
    const [, lastColor] = stops[stops.length - 1];
    expect(alphaOf(lastColor)).toBe(0);

    await r.unmount();
  });

  it('interpolates every segment within one hue', async () => {
    const r = await render(felt(BESNIK));

    // SVG interpolates stops non-premultiplied, so a run between two hues with
    // a transparent stop at one end reads as grey at half strength on both
    // renderers rather than as a fade.
    const stops = gradientStops('feltNap');
    expect(stops.length).toBeGreaterThanOrEqual(3);
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

  it('draws the weave as shadow, so it cannot outlive the light', async () => {
    const r = await render(felt(BESNIK));

    // Read off the packed colour the native side is handed, not off the token:
    // a thread that adds light is the one shape this must never go back to,
    // and the token is only where it would be written.
    const strokes: number[] = [];
    const walk = (node: any) => {
      if (!node || typeof node === 'string') return;
      const packed = node.props?.stroke?.payload;
      if (typeof packed === 'number') strokes.push(packed);
      (node.children ?? []).forEach(walk);
    };
    walk(screen.toJSON());

    expect(strokes).toHaveLength(2);
    for (const packed of strokes) {
      expect(packed & 0x00ffffff).toBe(0);
      expect(alphaOf(packed)).toBeGreaterThan(0);
    }
    // Two depths, not one: a single depth crossing itself is a grid, and cloth
    // is woven over and under.
    expect(new Set(strokes.map(alphaOf)).size).toBe(2);

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
    // Under them the threads would shade the sheen, and the pile catches the
    // lamp on top of the cloth rather than through it.
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
