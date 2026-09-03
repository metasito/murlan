// tests/native/musicRouteSameTrack.test.tsx — #885: Friends, Online, Offline
// and Leaderboard all resolve to trackForRoute's "menu" (app/_layout.tsx), so
// a menu-to-menu tap changes pathname without changing what should be
// playing. The route effect is keyed on the derived track, not on pathname,
// so this must not re-request it — playMusic is mocked here specifically so
// the assertion is about whether the effect fires, independent of whatever
// lib/music.ts itself does with a repeat request (tests/native/musicPlatform
// .test.tsx covers that half separately).
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
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

jest.mock('@/lib/music', () => ({
  playMusic: jest.fn(async () => {}),
}));

import { NotificationProvider } from '@/context/NotificationContext';
import { RootLayoutNav } from '@/app/_layout';
import { playMusic } from '@/lib/music';

const playMusicMock = playMusic as jest.Mock;

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

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  playMusicMock.mockClear();
  mockPathname = '/';
});

describe('the route effect across screens that share one track', () => {
  it('does not re-request the track on a menu-to-menu navigation', async () => {
    mockPathname = '/lobby';
    const r = await render(<Harness />);
    await flush();

    expect(playMusicMock).toHaveBeenCalledTimes(1);
    expect(playMusicMock).toHaveBeenCalledWith('menu');

    mockPathname = '/profile';
    await act(async () => r.rerender(<Harness />));
    await flush();

    expect(playMusicMock).toHaveBeenCalledTimes(1);

    await r.unmount();
  });

  it('still requests the track on a genuine change', async () => {
    mockPathname = '/lobby';
    const r = await render(<Harness />);
    await flush();

    mockPathname = '/game';
    await act(async () => r.rerender(<Harness />));
    await flush();

    expect(playMusicMock).toHaveBeenCalledTimes(2);
    expect(playMusicMock).toHaveBeenLastCalledWith('hand');

    await r.unmount();
  });
});
