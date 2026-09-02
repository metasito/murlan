// tests/native/musicRouteReentry.test.tsx — #449: the game track goes silent
// on a second entry to the table. Driving the real RootLayoutNav through a
// pathname that leaves /game and comes back rules out the route effect
// itself (`[pathname]` genuinely changes on every in-app navigation this app
// has, and the mocked player's `play()` fires again every time — see the
// first case). What reproduces the silence is the shape the owner actually
// described: leaving the app and coming back to the same route, where
// `pathname` never changes at all, and nothing here answers `AppState`.
import { describe, it, expect, beforeEach, afterAll, jest } from '@jest/globals';
import React from 'react';
import { render, act } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

let mockPathname = '/';

jest.mock('expo-router', () => {
  function Stack({ children }: { children?: unknown }) {
    return children ?? null;
  }
  Stack.Screen = function StackScreen() {
    return null;
  };
  Stack.Protected = function StackProtected({ children }: { children?: unknown }) {
    return children ?? null;
  };
  return {
    Stack,
    usePathname: () => mockPathname,
    router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  };
});

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: { addEventListener: jest.fn(() => () => {}) },
}));

jest.mock('@/lib/accessibility', () => ({
  usePrefersReducedMotion: () => true,
  setMotionPreference: () => {},
  getMotionPreference: () => 'off',
}));

jest.mock('expo-audio', () => ({
  createAudioPlayer: jest.fn(() => ({
    play: jest.fn(),
    pause: jest.fn(),
    remove: jest.fn(),
    volume: 0,
    loop: false,
  })),
  setAudioModeAsync: jest.fn(async () => {}),
}));

import { NotificationProvider } from '@/context/NotificationContext';
import { RootLayoutNav } from '@/app/_layout';
import { unloadMusic } from '@/lib/music';

const createAudioPlayer = (require('expo-audio') as { createAudioPlayer: jest.Mock })
  .createAudioPlayer;

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function Harness() {
  return (
    <SafeAreaProvider initialMetrics={METRICS}>
      <NotificationProvider>
        <RootLayoutNav />
      </NotificationProvider>
    </SafeAreaProvider>
  );
}

/** playMusic awaits ensureAudioMode before it reaches the player. */
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  unloadMusic();
  createAudioPlayer.mockClear();
  (AppState.addEventListener as jest.Mock).mockClear?.();
  mockPathname = '/';
});

// The fades are real timers; without this the worker outlives the run.
afterAll(() => {
  unloadMusic();
});

describe('music on a second entry to /game', () => {
  it('plays the hand track again after leaving through another route and coming back', async () => {
    mockPathname = '/game';
    const r = await render(<Harness />);
    await flush();

    const handPlayer = createAudioPlayer.mock.results[0].value as { play: jest.Mock };
    expect(handPlayer.play).toHaveBeenCalledTimes(1);

    mockPathname = '/';
    await act(async () => r.rerender(<Harness />));
    await flush();

    mockPathname = '/game';
    await act(async () => r.rerender(<Harness />));
    await flush();

    expect(handPlayer.play).toHaveBeenCalledTimes(2);

    await r.unmount();
  });

  it('plays the hand track again after the app leaves and returns to the foreground on the same route', async () => {
    mockPathname = '/game';
    const r = await render(<Harness />);
    await flush();

    const handPlayer = createAudioPlayer.mock.results[0].value as { play: jest.Mock };
    expect(handPlayer.play).toHaveBeenCalledTimes(1);

    // pathname never changes here — this is the shape the owner described:
    // leaving the app (not the route) and coming back to the same table.
    const listener = (AppState.addEventListener as jest.Mock).mock.calls.find(
      ([event]) => event === 'change'
    )?.[1] as ((state: string) => void) | undefined;
    expect(listener).toBeDefined();

    await act(async () => listener!('background'));
    await flush();
    await act(async () => listener!('active'));
    await flush();

    expect(handPlayer.play).toHaveBeenCalledTimes(2);

    await r.unmount();
  });
});
