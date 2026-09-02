// tests/native/musicRouteReentry.test.tsx — #449: rules out the route effect
// itself as a cause of the silent second entry. Driving the real
// RootLayoutNav through `/game -> / -> /game` shows `[pathname]` genuinely
// changes on every in-app navigation this app has, and the mocked player's
// `play()` fires again on both entries — this path was never broken. What
// was silent is covered separately, at the module that owns it
// (tests/native/musicResume.test.tsx, lib/music.ts's own AppState handling).
import { describe, it, expect, beforeEach, afterAll, jest } from '@jest/globals';
import React from 'react';
import { render, act } from '@testing-library/react-native';
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
    seekTo: jest.fn(),
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
  mockPathname = '/';
});

// The fades are real timers; without this the worker outlives the run.
afterAll(() => {
  unloadMusic();
});

describe('music on a second entry to /game via in-app navigation', () => {
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
});
