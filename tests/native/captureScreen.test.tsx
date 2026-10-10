// tests/native/captureScreen.test.tsx — the capture harness mounts.
//
// `app/capture.tsx` is the only instrument that reaches iOS (docs/agents/checks.md).
// It is not on any player's route, so nothing else exercises it: a harness that
// throws on mount is discovered by the person who was asked for a screenshot,
// which is exactly the round trip it exists to remove.
//
// What this can see is that every state in the list builds a table the renderer
// accepts, and that the swing knob is a reachable control. What it cannot see is
// anything the capture is actually for — `react-test-renderer` runs no flexbox
// and paints nothing, so which seat is covered by what is not a question any
// test here can answer.
import { describe, it, expect, jest } from '@jest/globals';
import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { getAnimatedStyle } from 'react-native-reanimated';
import { greyFilter } from '@/components/table/linkGrey';
import { holdGrey } from '@/lib/ownLink';

// The table is landscape-locked and jest-expo's own window is a fixed portrait
// one, which is a different card scale. Everything else here is the same shape
// the other <GameTable> tests use.
const WINDOW = { width: 874, height: 402, scale: 3, fontScale: 1 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => WINDOW,
}));

jest.mock('@/lib/accessibility', () => ({
  usePrefersReducedMotion: () => true,
  setMotionPreference: () => {},
  getMotionPreference: () => 'off',
}));

const METRICS = {
  frame: { x: 0, y: 0, width: WINDOW.width, height: WINDOW.height },
  insets: { top: 0, left: 59, right: 59, bottom: 21 },
};

// `mock`-prefixed so jest's module factory may close over it.
let mockParams: Record<string, string | undefined> = {};

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => mockParams,
  usePathname: () => '/capture',
}));

// Required after the mocks, so the screen picks them up.
const CaptureScreen = require('@/app/capture').default as React.ComponentType;
const { ALL_CAPTURE_STATES, captureStateById } = require('@/lib/captureStates') as typeof import('@/lib/captureStates');
const { redirectSystemPath } = require('@/app/+native-intent') as typeof import('@/app/+native-intent');

const mount = () =>
  render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <CaptureScreen />
    </SafeAreaProvider>
  );

describe('the capture screen', () => {
  it('lists every named state when none is picked', async () => {
    mockParams = {};
    const view = await mount();
    for (const state of ALL_CAPTURE_STATES) {
      expect(screen.getByLabelText(state.label)).toBeTruthy();
    }
    await view.unmount();
  });

  it.each(ALL_CAPTURE_STATES.map((s) => [s.id] as const))('renders %s', async (id) => {
    mockParams = { state: id };
    const view = await mount();
    expect(screen.getByTestId('game-table')).toBeTruthy();
    // The swing is the one state that needs an input rather than a route, so a
    // capture cannot be taken of the handover without it.
    expect(screen.getByLabelText('Move the lamp to the next seat')).toBeTruthy();
    const link = captureStateById(id)?.link ?? 'up';
    expect((getAnimatedStyle(screen.getByTestId('game-table')) as { filter?: string }).filter).toBe(Platform.OS === 'ios' ? undefined : greyFilter(holdGrey(link)));
    await view.unmount();
  });

  const asBuilt = async (e2eFlag: string | undefined, body: () => Promise<void>) => {
    const g = globalThis as { __DEV__?: boolean };
    const [dev, flag] = [g.__DEV__, process.env.EXPO_PUBLIC_E2E_FAST];
    g.__DEV__ = false;
    if (e2eFlag === undefined) delete process.env.EXPO_PUBLIC_E2E_FAST;
    else process.env.EXPO_PUBLIC_E2E_FAST = e2eFlag;
    try {
      await body();
    } finally {
      g.__DEV__ = dev;
      if (flag === undefined) delete process.env.EXPO_PUBLIC_E2E_FAST;
      else process.env.EXPO_PUBLIC_E2E_FAST = flag;
    }
  };
  const HELD_LINK = { path: 'murlan://capture?state=held', initial: true };

  it('a production build follows no capture link and shows only that the screen is unavailable', () =>
    asBuilt(undefined, async () => {
      expect(redirectSystemPath(HELD_LINK)).toBe('/');
      mockParams = { state: 'held' };
      const view = await mount();
      expect(screen.getByText('The capture screen is a development or e2e build only.')).toBeTruthy();
      expect(screen.queryByTestId('game-table')).toBeNull();
      await view.unmount();
    }));

  it('an e2e build opens a capture state by link', () =>
    asBuilt('1', async () => {
      expect(redirectSystemPath(HELD_LINK)).toBe('/capture?state=held');
      expect(redirectSystemPath({ path: 'murlan://rules', initial: true })).toBe('/');
      mockParams = { state: 'held' };
      const view = await mount();
      expect(screen.getByTestId('game-table')).toBeTruthy();
      await view.unmount();
    }));
});
