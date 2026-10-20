import { describe, it, expect, jest, afterEach } from '@jest/globals';
import React from 'react';
import { act, render } from '@testing-library/react-native';
import { makeMutable } from 'react-native-reanimated';

const mockWithRepeat = jest.fn();
jest.mock('react-native-reanimated', () => {
  const actual = jest.requireActual('react-native-reanimated') as Record<string | symbol, unknown>;
  return new Proxy(actual, {
    get: (target, key) =>
      key === 'withRepeat'
        ? (...args: unknown[]) => {
            mockWithRepeat(...args);
            return (target.withRepeat as (...a: unknown[]) => unknown)(...args);
          }
        : target[key],
  });
});
jest.mock('@/lib/accessibility', () => ({
  usePrefersReducedMotion: () => false,
  setMotionPreference: () => {},
  getMotionPreference: () => 'off',
}));

const { CountdownRing } = require('@/components/table/seats') as typeof import('@/components/table/seats');

const ring = (held: boolean) => (
  <CountdownRing size={40} seconds={1} resetKey="t" held={held} scale={1} fade={makeMutable(1)} />
);

describe('the turn ring re-arming after its clock ran out', () => {
  afterEach(() => {
    jest.useRealTimers();
    mockWithRepeat.mockClear();
  });

  it('starts no repeat, since a count of 0 repeats forever', async () => {
    jest.useFakeTimers();
    const view = await render(ring(false));
    await act(async () => {
      jest.advanceTimersByTime(1500);
    });
    await view.rerender(ring(true));
    mockWithRepeat.mockClear();
    await view.rerender(ring(false));

    expect(mockWithRepeat).not.toHaveBeenCalled();
    await view.unmount();
  });
});
