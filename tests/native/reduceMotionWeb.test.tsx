import { describe, it, expect, beforeAll, jest } from '@jest/globals';
import React from 'react';
import { Platform, Text } from 'react-native';
import { act, render } from '@testing-library/react-native';

import { usePrefersReducedMotion, setMotionPreference } from '@/lib/accessibility';

function Probe() {
  return <Text>{usePrefersReducedMotion() ? 'reduced' : 'full'}</Text>;
}

describe('the browser reduce-motion setting is read through one listener', () => {
  const added = jest.fn<(type: string, fn: () => void) => void>();
  const removed = jest.fn<(type: string, fn: () => void) => void>();
  const query = { matches: false, addEventListener: added, removeEventListener: removed };

  beforeAll(() => {
    jest.replaceProperty(Platform, 'OS', 'web');
    (globalThis as { window?: unknown }).window ??= globalThis;
    (globalThis as unknown as { matchMedia: () => typeof query }).matchMedia = () => query;
    setMotionPreference('system');
  });

  it('adds one MediaQueryList listener for N subscribers, and releases it at zero', async () => {
    const view = await render(
      <>
        <Probe />
        <Probe />
        <Probe />
      </>
    );
    expect(added).toHaveBeenCalledTimes(1);

    query.matches = true;
    await act(async () => added.mock.calls[0][1]());
    expect(view.getAllByText('reduced')).toHaveLength(3);

    await view.unmount();
    expect(removed).toHaveBeenCalledTimes(1);
    expect(removed.mock.calls[0][1]).toBe(added.mock.calls[0][1]);
  });
});
