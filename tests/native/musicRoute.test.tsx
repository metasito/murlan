// tests/native/musicRoute.test.tsx — the route effect in app/_layout.tsx asks
// for music by the route's track, never by the route: menu screens share one
// track (#885), and a second entry to /game starts the hand again (#449).
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import React from 'react';
import { render, act } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { setMusicVolume } from '@/lib/device/feedback';
import { api, bootFeedback, fileOf, loops, settle } from './helpers/feedback';

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

import { NotificationProvider } from '@/context/NotificationContext';
import { RootLayoutNav } from '@/app/_layout';

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

async function go(r: Awaited<ReturnType<typeof render>>, pathname: string): Promise<void> {
  mockPathname = pathname;
  await act(async () => r.rerender(<Harness />));
  await settle(1000);
}

describe('music follows the route', () => {
  beforeEach(async () => {
    jest.useFakeTimers();
    setMusicVolume(0);
    await bootFeedback();
    mockPathname = '/';
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('starts nothing new on a menu-to-menu navigation', async () => {
    mockPathname = '/lobby';
    const r = await render(<Harness />);
    await settle(1000);
    expect(loops().map(fileOf)).toEqual(['menu']);
    await go(r, '/profile');
    expect(loops().map(fileOf)).toEqual(['menu']);
    await r.unmount();
  });

  it('starts the hand once on the way from a menu to the table', async () => {
    mockPathname = '/lobby';
    const r = await render(<Harness />);
    await settle(1000);
    await go(r, '/game');
    expect(loops().map(fileOf)).toEqual(['menu', 'hand']);
    await r.unmount();
  });

  it('starts the hand again after a menu, on a second entry to the table', async () => {
    mockPathname = '/game';
    const r = await render(<Harness />);
    await settle(1000);
    await go(r, '/');
    await go(r, '/game');
    expect(loops().map(fileOf)).toEqual(['hand', 'menu', 'hand']);
    await r.unmount();
  });

  it('makes no session call on a navigation', async () => {
    mockPathname = '/lobby';
    const r = await render(<Harness />);
    await settle(1000);
    await go(r, '/game');
    expect(api().log).not.toContain('session');
    await r.unmount();
  });
});
