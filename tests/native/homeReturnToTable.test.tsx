// tests/native/homeReturnToTable.test.tsx — a player whose online table is
// still holding their seat has no way back to it from home unless home says
// so. The decision is `homeMenuModel`'s and unit-tested there; what a scan
// cannot see is whether the screen ever asks storage, so this renders it.
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const mockPush = jest.fn();
let mockStoredRoom: string | null = null;
let mockAuthUser: { id: string; username: string; tutorialSeenAt: string | null } | null = null;

jest.mock('expo-router', () => ({
  router: { push: mockPush, replace: jest.fn(), back: jest.fn() },
  useIsFocused: () => true,
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => mockStoredRoom),
    setItem: jest.fn(async () => {}),
    removeItem: jest.fn(async () => {}),
  },
}));

jest.mock('@/components/SettingsModal', () => ({ SettingsModal: () => null }));

jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: mockAuthUser, loading: false }),
}));
jest.mock('@/context/GameContext', () => ({
  useGame: () => ({ hasSavedGame: true, resumeGame: () => false }),
}));
jest.mock('@/context/SocketContext', () => ({ useSocket: () => ({ gameInvites: [] }) }));
jest.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: [] }) }));
jest.mock('@/lib/query-client', () => ({
  getApiUrl: () => 'http://localhost',
  apiRequest: jest.fn(async () => ({ json: async () => ({}) })),
}));
jest.mock('@/lib/accessibility', () => ({
  usePrefersReducedMotion: () => true,
  setMotionPreference: () => {},
  getMotionPreference: () => 'off',
}));

import HomeScreen from '@/app/index';
import { t } from '@/lib/i18n';

const METRICS = {
  frame: { x: 0, y: 0, width: 844, height: 390 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

const mount = () =>
  render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <HomeScreen />
    </SafeAreaProvider>
  );

describe('the home screen and a table still holding a seat', () => {
  beforeEach(() => {
    mockPush.mockClear();
    mockStoredRoom = null;
    mockAuthUser = { id: 'u1', username: 'Ana', tutorialSeenAt: new Date().toISOString() };
  });

  it('offers the way back, ahead of the offline save', async () => {
    mockStoredRoom = 'room-42';
    const view = await mount();

    const hero = await screen.findByText(t('home.returnToTable'), {
      includeHiddenElements: true,
    });
    expect(hero).toBeTruthy();
    expect(
      screen.getByText(t('home.resumeGame'), { includeHiddenElements: true })
    ).toBeTruthy();

    await view.unmount();
  });

  it('offers nothing of the kind with no room recorded', async () => {
    const view = await mount();

    expect(
      screen.queryByText(t('home.returnToTable'), { includeHiddenElements: true })
    ).toBeNull();
    expect(
      await screen.findByText(t('home.resumeGame'), { includeHiddenElements: true })
    ).toBeTruthy();

    await view.unmount();
  });

  it('asks nothing of storage for a signed-out player', async () => {
    mockAuthUser = null;
    mockStoredRoom = 'room-42';
    const view = await mount();

    expect(
      screen.queryByText(t('home.returnToTable'), { includeHiddenElements: true })
    ).toBeNull();

    await view.unmount();
  });
});
