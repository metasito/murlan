// tests/native/giocaCuesRemount.test.tsx — GIOCA flashes when the staging changes, not when the
// control mounts over a staging that was already there (the seat turning back from spectator).
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import React from 'react';
import { act, render, screen } from '@testing-library/react-native';
import Animated, { getAnimatedStyle } from 'react-native-reanimated';
import { useGiocaCues } from '@/components/useTableFeedback';
import { Motion } from '@/lib/theme';

function Probe({ count }: { count: number }) {
  const { flashStyle } = useGiocaCues(false, count, true);
  return <Animated.View testID="flash" style={flashStyle} />;
}

const flash = () => (getAnimatedStyle(screen.getByTestId('flash')) as { opacity: number }).opacity;
const halfTap = () => act(async () => jest.advanceTimersByTime(Motion.duration.tap / 2));

describe("GIOCA's flash", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('stays dark when it mounts over a staged count, and fires when the count then changes', async () => {
    const view = await render(<Probe count={2} />);
    await halfTap();
    expect(flash()).toBe(0);

    await view.rerender(<Probe count={3} />);
    await halfTap();
    expect(flash()).toBeGreaterThan(0);
    await view.unmount();
  });
});
