// tests/native/feltTranslate.test.tsx — the lamp's pool moves by its own
// layout, not by a transform on the view the SVGs sit in.
//
// felt.tsx already lost this exact fight once, for scale (feltEllipse.test.tsx):
// a `transform` on a view wrapping an `<Svg>` never reaches react-native-svg's
// native paint, which reads the view's own laid-out bounds instead. The pool's
// translate sat on that same ancestor, unfixed by that repair — so on iOS the
// anchor's frame moved to the seat on move while the gradients it carries kept
// painting at the origin, leaving a dark, stationary pool pinned in the corner
// over the rest of the table (#209).
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import React from 'react';
import { StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { act, render, screen } from '@testing-library/react-native';
import { FeltPool } from '@/components/table/felt';
import { FeltGradients } from '@/lib/tokens';

const W = 874;
const H = 402;
// BESNIK — the left seat, one of lightPosition()'s (components/gameTableModel.ts)
// off-viewer fractions.
const LIGHT_X = 0.02;
const LIGHT_Y = 0.48;
/** Comfortably past felt.tsx's own LAMP_MS swing, so withTiming has settled. */
const SETTLE_MS = 900;

const anchorStyle = () => StyleSheet.flatten(screen.getByTestId('felt-lamp-anchor').props.style);

describe('the lamp pool moves by layout, not by a transform on the SVGs’ ancestor', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('lands the anchor at the lamp’s own point, off the corner', async () => {
    const r = await render(
      <FeltPool width={W} height={H} stops={FeltGradients.verde} lightX={LIGHT_X} lightY={LIGHT_Y} />
    );
    await act(async () => {
      jest.advanceTimersByTime(SETTLE_MS);
    });

    const style = anchorStyle();
    expect(style.left).toBeCloseTo(LIGHT_X * W, 0);
    expect(style.top).toBeCloseTo(LIGHT_Y * H, 0);
    expect(style.transform).toBeUndefined();

    await r.unmount();
  });

  // The floor. The construction this replaces — a translate on the ancestor,
  // left/top left pinned at the corner — has to fail the same assertions, or
  // they are not looking at anything.
  it('rejects the pool positioned by a transform on its own ancestor', async () => {
    function TransformAnchor() {
      const x = useSharedValue(LIGHT_X * W);
      const y = useSharedValue(LIGHT_Y * H);
      const style = useAnimatedStyle(() => ({
        transform: [{ translateX: x.value }, { translateY: y.value }],
      }));
      return (
        <Animated.View
          testID="felt-lamp-anchor"
          style={[{ position: 'absolute', left: 0, top: 0, width: 0, height: 0 }, style]}
        />
      );
    }

    const r = await render(<TransformAnchor />);
    await act(async () => {
      jest.advanceTimersByTime(SETTLE_MS);
    });

    const style = anchorStyle();
    expect(style.left).toBe(0);
    expect(style.top).toBe(0);
    expect(style.transform).toBeDefined();

    await r.unmount();
  });
});
