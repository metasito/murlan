import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import React, { useEffect } from 'react';
import { render } from '@testing-library/react-native';
import { setMotion } from './harness/env';

const mockWithRepeat = jest.fn();
const mockCancel = jest.fn();
jest.mock('react-native-reanimated', () => {
  const actual = jest.requireActual('react-native-reanimated') as Record<string | symbol, unknown>;
  const spied: Record<string, jest.Mock> = { withRepeat: mockWithRepeat, cancelAnimation: mockCancel };
  return new Proxy(actual, {
    get: (target, key) =>
      typeof key === 'string' && key in spied
        ? (...args: unknown[]) => {
            spied[key](...args);
            return (target[key] as (...a: unknown[]) => unknown)(...args);
          }
        : target[key],
  });
});
const { withTiming } = require('react-native-reanimated') as typeof import('react-native-reanimated');
const { repeatTimes, useLoop, useOwnedValue } = require('@/lib/motion') as typeof import('@/lib/motion');

const seen: { value: unknown }[] = [];
function Looping({ on, loopKey }: { on: boolean; loopKey?: string }) {
  const value = useOwnedValue(0);
  useEffect(() => {
    seen[0] = value;
  }, [value]);
  useLoop(value, on ? () => ({ cycle: withTiming(1, { duration: 10 }) }) : null, loopKey);
  return null;
}
const cancelsOf = () => mockCancel.mock.calls.filter(([v]) => v === seen[0]).length;

describe('useLoop', () => {
  beforeEach(() => {
    mockWithRepeat.mockClear();
    mockCancel.mockClear();
  });

  it('never starts under reduced motion', async () => {
    await setMotion('on');
    const view = await render(<Looping on />);
    expect(mockWithRepeat).not.toHaveBeenCalled();
    await view.unmount();
  });

  it('starts an endless loop at full motion, and cancels it when asked to stop', async () => {
    await setMotion('off');
    const view = await render(<Looping on />);
    expect(mockWithRepeat).toHaveBeenCalledTimes(1);
    expect(mockWithRepeat.mock.calls[0][1]).toBe(-1);
    mockCancel.mockClear();
    await view.rerender(<Looping on={false} />);
    expect(cancelsOf()).toBeGreaterThanOrEqual(1);
    await view.unmount();
  });

  it('cancels the loop when its owner unmounts', async () => {
    await setMotion('off');
    const view = await render(<Looping on />);
    mockCancel.mockClear();
    await view.unmount();
    expect(cancelsOf()).toBeGreaterThanOrEqual(1);
  });

  it('cancels a running loop when the player turns motion down', async () => {
    await setMotion('off');
    const view = await render(<Looping on />);
    mockCancel.mockClear();
    await setMotion('on');
    expect(cancelsOf()).toBeGreaterThanOrEqual(1);
    await view.unmount();
  });

  it('restarts on a new key, and not on a rerender alone', async () => {
    await setMotion('off');
    const view = await render(<Looping on loopKey="a" />);
    await view.rerender(<Looping on loopKey="a" />);
    expect(mockWithRepeat).toHaveBeenCalledTimes(1);
    await view.rerender(<Looping on loopKey="b" />);
    expect(mockWithRepeat).toHaveBeenCalledTimes(2);
    await view.unmount();
  });
});

describe('repeatTimes', () => {
  it('runs nothing for a count under one, where withRepeat would loop forever', () => {
    const cycle = withTiming(1, { duration: 10 });
    expect(repeatTimes(cycle, 0)).toBeNull();
    expect(repeatTimes(cycle, Number.NaN)).toBeNull();
    expect(repeatTimes(cycle, -1)).toBeNull();
    expect(repeatTimes(cycle, 2)).not.toBeNull();
  });
});
