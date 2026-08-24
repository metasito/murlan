// tests/native/feltTranslate.test.tsx — the lamp's anchor moves to a new
// lamp point on rerender, not just at mount, using whichever construction
// felt.tsx picks for the running platform. See felt.tsx's header for why iOS
// alone swings by `left`/`top` rather than `transform`.
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import React from 'react';
import { Platform } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';
import { FeltPool } from '@/components/table/felt';
import { FeltGradients } from '@/lib/tokens';

const W = 874;
const H = 402;
// BESNIK and LUAN — two of lightPosition()'s (components/gameTableModel.ts)
// off-viewer fractions, on opposite sides of the table.
const BESNIK = { x: 0.02, y: 0.48 };
const LUAN = { x: 0.98, y: 0.48 };
/** Comfortably past felt.tsx's own LAMP_MS swing, so withTiming has settled. */
const SETTLE_MS = 900;

/**
 * `props.style` only reflects the worklet's first run under Reanimated's jest
 * shim — a later mutation of the shared value lands in `jestAnimatedStyle`
 * instead, which only this reads back. Reanimated ships `getAnimatedStyle`
 * for exactly this, but it throws on a `null` entry in the style array
 * (`POOL_LAYER` on this anchor outside web) — the same merge, tolerant of it.
 */
function anchorStyle() {
  const { props } = screen.getByTestId('felt-lamp-anchor');
  const inline = props.jestInlineStyle;
  let merged: Record<string, unknown> = {};
  for (const entry of Array.isArray(inline) ? inline : [inline]) {
    if (!entry || 'jestAnimatedValues' in entry) continue;
    merged = { ...merged, ...entry };
  }
  return { ...merged, ...(props.jestAnimatedStyle?.value ?? {}) };
}

/** Reads the anchor's position back out, whichever construction produced it. */
function anchorPoint(style: ReturnType<typeof anchorStyle>) {
  if (Platform.OS === 'ios') {
    return { x: style.left, y: style.top };
  }
  const translate = (style.transform ?? []) as Record<string, number>[];
  return {
    x: translate.find((t) => 'translateX' in t)?.translateX,
    y: translate.find((t) => 'translateY' in t)?.translateY,
  };
}

describe('the lamp pool moves by whichever construction the platform reads', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('lands the anchor at the lamp’s own point, and moves it again on rerender', async () => {
    const r = await render(
      <FeltPool width={W} height={H} stops={FeltGradients.verde} lightX={BESNIK.x} lightY={BESNIK.y} />
    );
    await act(async () => {
      jest.advanceTimersByTime(SETTLE_MS);
    });

    let point = anchorPoint(anchorStyle());
    expect(point.x).toBeCloseTo(BESNIK.x * W, 0);
    expect(point.y).toBeCloseTo(BESNIK.y * H, 0);
    if (Platform.OS === 'ios') {
      expect(anchorStyle().transform).toBeUndefined();
    }

    // The turn passes to the seat opposite. If the value driving the anchor
    // stopped updating — the frozen-lamp failure this ticket also reported —
    // this is the assertion that catches it: a mount-only snapshot cannot.
    await act(async () => {
      r.rerender(
        <FeltPool width={W} height={H} stops={FeltGradients.verde} lightX={LUAN.x} lightY={LUAN.y} />
      );
    });
    await act(async () => {
      jest.advanceTimersByTime(SETTLE_MS);
    });

    point = anchorPoint(anchorStyle());
    expect(point.x).toBeCloseTo(LUAN.x * W, 0);
    expect(point.y).toBeCloseTo(LUAN.y * H, 0);

    await r.unmount();
  });
});
