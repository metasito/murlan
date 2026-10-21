import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import React from 'react';
import { Text, AccessibilityInfo } from 'react-native';
import { act, render } from '@testing-library/react-native';

import {
  usePrefersReducedMotion,
  setMotionPreference,
  getMotionPreference,
} from '@/lib/accessibility';

// A player who finds the table too busy should be able to calm this one game
// down without changing an OS-wide accessibility setting — and a player who
// wants the full animation should keep it even if the OS asks to reduce.
//
// About twenty components read usePrefersReducedMotion, so the override lives
// inside the hook and none of them know about it. These tests are what says
// that indirection actually works.
//
// The module is imported once rather than re-required per test: resetModules
// would hand the hook a second copy of React and every render would throw.
// State is reset through the module's own setter instead.
function Probe() {
  const reduced = usePrefersReducedMotion();
  return <Text>{reduced ? 'reduced' : 'full'}</Text>;
}

/**
 * The system setting arrives from a promise, so the mount is followed by an
 * empty async act() to settle it. Awaiting `render` instead lets it land
 * between two act() scopes, where React reports the update as untracked.
 */
async function mount() {
  const view = await render(<Probe />);
  await act(async () => {});
  return view;
}

describe('motion preference overrides the system setting', () => {
  let systemAsksToReduce: jest.SpiedFunction<typeof AccessibilityInfo.isReduceMotionEnabled>;

  beforeEach(() => {
    setMotionPreference('system');
    systemAsksToReduce = jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockResolvedValue(false);
    jest.spyOn(AccessibilityInfo, 'addEventListener').mockReturnValue({
      remove: () => {},
    } as ReturnType<typeof AccessibilityInfo.addEventListener>);
  });

  afterEach(async () => {
    // This file's hook runs before the library's auto-cleanup, so the reset
    // still reaches a mounted tree.
    await act(async () => setMotionPreference('system'));
    jest.restoreAllMocks();
  });

  it('defaults to following the system', () => {
    expect(getMotionPreference()).toBe('system');
  });

  it('"on" reduces motion even when the system does not ask for it', async () => {
    setMotionPreference('on');
    const view = await mount();
    expect(view.getByText('reduced')).toBeTruthy();
  });

  it('"off" keeps full motion even when the system asks to reduce it', async () => {
    systemAsksToReduce.mockResolvedValue(true);
    setMotionPreference('off');
    const view = await mount();
    expect(view.getByText('full')).toBeTruthy();
  });

  it('"system" follows the OS', async () => {
    systemAsksToReduce.mockResolvedValue(true);
    const view = await mount();
    expect(view.getByText('reduced')).toBeTruthy();
  });

  it('a change re-renders a component that is already mounted', async () => {
    setMotionPreference('off');
    const view = await mount();
    expect(view.getByText('full')).toBeTruthy();
    await act(async () => setMotionPreference('on'));
    expect(view.getByText('reduced')).toBeTruthy();
  });
});

// #837: the CI-only automation flag that pauses looping decorative animation on a device
// loop's emulator. It has to win over a player's own "off" choice — a fresh CI build never
// makes that choice, and the point of the flag is that nothing here can suppress it.
describe('the CI automation flag (EXPO_PUBLIC_E2E_REDUCE_MOTION) forces reduced motion', () => {
  const ORIGINAL = process.env.EXPO_PUBLIC_E2E_REDUCE_MOTION;

  beforeEach(() => {
    setMotionPreference('off');
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
    jest.spyOn(AccessibilityInfo, 'addEventListener').mockReturnValue({
      remove: () => {},
    } as ReturnType<typeof AccessibilityInfo.addEventListener>);
  });

  afterEach(async () => {
    if (ORIGINAL === undefined) delete process.env.EXPO_PUBLIC_E2E_REDUCE_MOTION;
    else process.env.EXPO_PUBLIC_E2E_REDUCE_MOTION = ORIGINAL;
    await act(async () => setMotionPreference('system'));
    jest.restoreAllMocks();
  });

  it('reduces motion even over an explicit "off" preference and a system "no"', async () => {
    process.env.EXPO_PUBLIC_E2E_REDUCE_MOTION = '1';
    const view = await mount();
    expect(view.getByText('reduced')).toBeTruthy();
  });

  it('does nothing when unset — a normal build never sees this branch', async () => {
    delete process.env.EXPO_PUBLIC_E2E_REDUCE_MOTION;
    const view = await mount();
    expect(view.getByText('full')).toBeTruthy();
  });
});

describe('the native reduce-motion setting is read through one listener', () => {
  let asked: jest.SpiedFunction<typeof AccessibilityInfo.isReduceMotionEnabled>;
  let listened: jest.SpiedFunction<typeof AccessibilityInfo.addEventListener>;
  let released: jest.Mock;

  beforeEach(() => {
    setMotionPreference('system');
    asked = jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
    released = jest.fn();
    listened = jest.spyOn(AccessibilityInfo, 'addEventListener').mockReturnValue({
      remove: released,
    } as unknown as ReturnType<typeof AccessibilityInfo.addEventListener>);
    // react-native's jest setup already holds these as mocks, so a spy inherits their past calls.
    asked.mockClear();
    listened.mockClear();
  });

  afterEach(async () => {
    await act(async () => setMotionPreference('system'));
    jest.restoreAllMocks();
  });

  async function mountProbes(n: number) {
    const probes = (count: number) => (
      <>
        {Array.from({ length: count }, (_, i) => (
          <Probe key={i} />
        ))}
      </>
    );
    const view = await render(probes(n));
    await act(async () => {});
    return { view, probes };
  }

  it('adds one listener and asks once for N subscribers, and releases it at zero', async () => {
    const { view, probes } = await mountProbes(3);
    expect(listened).toHaveBeenCalledTimes(1);
    expect(asked).toHaveBeenCalledTimes(1);

    await view.rerender(probes(1));
    expect(released).not.toHaveBeenCalled();

    await view.unmount();
    expect(released).toHaveBeenCalledTimes(1);
  });

  it('a subscriber arriving after the release listens and asks again', async () => {
    const first = await mountProbes(2);
    await first.view.unmount();
    const second = await mountProbes(2);
    expect(listened).toHaveBeenCalledTimes(2);
    expect(asked).toHaveBeenCalledTimes(2);
    await second.view.unmount();
  });

  it('a change reaches every subscriber through the one listener', async () => {
    const { view } = await mountProbes(3);
    const onChange = listened.mock.calls[0][1] as unknown as (reduced: boolean) => void;
    await act(async () => onChange(true));
    expect(view.getAllByText('reduced')).toHaveLength(3);
    await view.unmount();
  });

  it('an initial "reduce" reaches every subscriber', async () => {
    asked.mockResolvedValue(true);
    const { view } = await mountProbes(3);
    expect(view.getAllByText('reduced')).toHaveLength(3);
    await view.unmount();
  });

  it('an answer to the first query that lands after a change event does not overwrite it', async () => {
    let answer: (reduced: boolean) => void = () => {};
    asked.mockReturnValue(new Promise<boolean>((resolve) => (answer = resolve)));
    const { view } = await mountProbes(3);
    const onChange = listened.mock.calls[0][1] as unknown as (reduced: boolean) => void;
    await act(async () => onChange(true));
    await act(async () => answer(false));
    expect(view.getAllByText('reduced')).toHaveLength(3);
    await view.unmount();
  });

  it('an answer that lands after its subscribers are gone does not reach the next ones', async () => {
    let stale: (reduced: boolean) => void = () => {};
    asked.mockReturnValueOnce(new Promise<boolean>((resolve) => (stale = resolve)));
    const first = await mountProbes(2);
    await first.view.unmount();
    asked.mockResolvedValue(false);
    const second = await mountProbes(2);
    await act(async () => stale(true));
    expect(second.view.getAllByText('full')).toHaveLength(2);
    await second.view.unmount();
  });
});
