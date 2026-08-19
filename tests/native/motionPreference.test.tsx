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
